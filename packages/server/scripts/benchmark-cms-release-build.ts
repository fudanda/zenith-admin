/**
 * Real builder baseline. Requires a migrated disposable local arcbase_review database.
 * TEST_DATABASE_URL=... npx tsx --tsconfig packages/server/tsconfig.json packages/server/scripts/benchmark-cms-release-build.ts --output C:/tmp/cms-build.json
 * Calls the production candidate builder directly: queue latency is explicitly excluded.
 * All fixture rows, generation schemas and static files are removed, including on failure.
 */
import '../src/lib/fatal-handlers';
import '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TaskRunContext } from '../src/lib/task-center/types';

const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error('TEST_DATABASE_URL is required');
const database = new URL(connection);
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) || database.pathname !== '/arcbase_review') throw new Error('Only a local disposable arcbase_review database is accepted');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? null : process.argv[outputIndex + 1];
if (outputIndex >= 0 && (!output || !path.isAbsolute(output) || !path.relative(process.cwd(), output).startsWith('..'))) throw new Error('--output must be an absolute path outside the repository');
if (output) await fs.mkdir(path.dirname(output), { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-real-build-baseline-'));
process.env.DATABASE_URL = connection;
process.env.CMS_STATIC_ROOT = path.join(root, 'static');
process.env.LOG_DIR = path.join(root, 'logs');
process.env.REDIS_KEY_PREFIX = `cms-build-baseline:${randomUUID()}:`;
process.env.LOG_LEVEL = 'warn';
// fatal-handlers statically imports only Node builtins; config is first loaded here, after overrides.
const { config } = await import('../src/config');
const { CMS_STATIC_ROOT, isStrictlyWithin } = await import('../src/services/cms/cms-static-path');
if (config.databaseUrl !== connection || new URL(config.databaseUrl).pathname !== '/arcbase_review') throw new Error('Resolved database configuration escaped the disposable benchmark database');
if (CMS_STATIC_ROOT !== path.join(root, 'static') || !isStrictlyWithin(root, CMS_STATIC_ROOT)) throw new Error('Resolved CMS static root escaped the temporary benchmark directory');
if (!config.redis.keyPrefix.startsWith('cms-build-baseline:')) throw new Error('Resolved cache prefix is not isolated');
const { db, closeDb } = await import('../src/db');
const { closeRedis } = await import('../src/lib/redis');
const { and, eq, inArray, sql } = await import('drizzle-orm');
const schema = await import('../src/db/schema');
const { runWithCurrentUser } = await import('../src/lib/context');
const { buildCmsReleaseCandidate, newCmsDeploymentBuildPlan } = await import('../src/services/cms/cms-release-build.service');
const { cmsGenerationSchemaName } = await import('../src/services/cms/cms-generation-storage.service');
const { cmsBuildSchema } = await import('../src/services/cms/cms-release-build-storage');
const { cmsBuildArtifactFile } = await import('../src/services/cms/cms-release-build-artifacts');
const { captureCmsConfiguration } = await import('../src/services/cms/cms-configuration-snapshot.service');
const { initializeCmsContentWorkingCopy, freezeCmsContentRevision } = await import('../src/services/cms/cms-content-revisions.service');

const sites: number[] = [];
const generations: number[] = [];
let userId: number | null = null;
const results: Array<Record<string, unknown>> = [];
let buildError: unknown;
try {
  const [user] = await db.insert(schema.users).values({ username: `qa-cms-scale-${randomUUID().slice(0, 8)}`, nickname: 'CMS scale benchmark', password: 'not-a-login-password' }).returning();
  userId = user.id;
  await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
    for (const count of [1000, 10000]) {
      const [site] = await db.insert(schema.cmsSites).values({ name: `CMS scale ${count}`, code: `qa-scale-${count}-${randomUUID().slice(0, 8)}`, theme: 'default', staticMode: 'static', settings: {} }).returning();
      sites.push(site.id);
      const [channel] = await db.insert(schema.cmsChannels).values({ siteId: site.id, name: 'News', code: 'news', slug: 'news', path: 'news', pageSize: 50 }).returning();
      const body = '<p>Approved publication benchmark content.</p>'.repeat(24);
      for (let offset = 0; offset < count; offset += 250) {
        await db.insert(schema.cmsContents).values(Array.from({ length: Math.min(250, count - offset) }, (_, index) => ({ siteId: site.id, channelId: channel.id, title: `Article ${offset + index + 1}`, slug: `article-${offset + index + 1}`, summary: 'Frozen release benchmark summary', body, status: 'published' as const, publishedAt: new Date('2026-09-01T00:00:00Z') })));
      }
      const [page] = await db.insert(schema.cmsPages).values({ siteId: site.id, name: 'Independent page', slug: 'about', blocks: [{ id: 'text', type: 'richtext', props: { html: '<p>Initial page.</p>' } }] }).returning();
      const createCandidate = async (name: string, baseGenerationId: number | null, revision?: { contentId: number; id: number; title: string }) => db.transaction(async (tx) => {
        const configuration = await captureCmsConfiguration(tx, site.id, revision ? {} : baseGenerationId ? { pageIds: [page.id] } : { includeSiteConfiguration: true });
        const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name, status: 'building', baseGenerationId, items: revision ? [{ contentId: revision.contentId, revisionId: revision.id, title: revision.title, action: 'publish' }] : [], configurationItems: configuration.items, configurationSnapshot: configuration.snapshot }).returning();
        const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, buildPlan: newCmsDeploymentBuildPlan() }).returning();
        generations.push(deployment.id);
        const [bound] = await tx.update(schema.cmsReleases).set({ deploymentId: deployment.id }).where(eq(schema.cmsReleases.id, release.id)).returning();
        return { release: bound, deployment };
      });
      const measure = async (kind: string, candidate: Awaited<ReturnType<typeof createCandidate>>, interruptAt?: number, forceFull = false) => {
        const phaseMs: Record<string, number> = {};
        let lastPhase = 'projection'; let lastMark = performance.now(); let interrupted = false;
        const started = performance.now();
        const ctx: TaskRunContext = {
          taskId: 0, dispatchToken: `direct-benchmark-${candidate.deployment.id}`, payload: { siteId: site.id, releaseId: candidate.release.id, deploymentId: candidate.deployment.id }, checkpoint: null, attempt: 1,
          isCancelRequested: async () => false, reportItems: async () => {},
          progress: async (update) => {
            const next = String(update.checkpoint?.phase ?? lastPhase);
            if (next !== lastPhase) {
              phaseMs[lastPhase] = (phaseMs[lastPhase] ?? 0) + performance.now() - lastMark;
              lastPhase = next; lastMark = performance.now();
              process.stderr.write(`${count} ${kind}: ${next}\n`);
            }
            if (interruptAt && !interrupted && next === 'static' && (update.processed ?? 0) >= interruptAt) { interrupted = true; throw new Error('injected benchmark interruption'); }
            if (next === 'static' && update.processed && update.processed % 1000 === 0) process.stderr.write(`${count} ${kind}: ${update.processed}/${update.total}\n`);
            return { cancelRequested: false };
          },
        };
        // The API/task handler normally supplies the dispatch-token guard. This direct benchmark uses
        // an equivalent release-ownership guard and reports that it excludes the queue/runner.
        const guard = async (tx: Parameters<Parameters<typeof buildCmsReleaseCandidate>[3]>[0]) => {
          const [owned] = await tx.select({ id: schema.cmsReleases.id }).from(schema.cmsReleases).where(and(eq(schema.cmsReleases.id, candidate.release.id), eq(schema.cmsReleases.deploymentId, candidate.deployment.id), eq(schema.cmsReleases.status, 'building'))).limit(1);
          if (!owned) throw new Error('Benchmark candidate lost ownership');
        };
        try { await buildCmsReleaseCandidate(candidate.release, candidate.deployment, ctx, guard, { forceFull }); }
        catch (error) {
          if (!interrupted || !(error instanceof Error) || error.message !== 'injected benchmark interruption') throw error;
          ctx.attempt = 2;
          const [resumed] = await db.select().from(schema.cmsDeployments).where(eq(schema.cmsDeployments.id, candidate.deployment.id));
          await buildCmsReleaseCandidate(candidate.release, resumed, ctx, guard);
        }
        phaseMs[lastPhase] = (phaseMs[lastPhase] ?? 0) + performance.now() - lastMark;
        const [finished] = await db.select().from(schema.cmsDeployments).where(eq(schema.cmsDeployments.id, candidate.deployment.id));
        if (finished.status !== 'ready') throw new Error('Builder did not produce a ready candidate');
        const measurement = { articles: count, kind, invocation: 'direct-production-builder; queue and task-runner excluded', elapsedMs: Math.round(performance.now() - started), phaseMs: Object.fromEntries(Object.entries(phaseMs).map(([key, value]) => [key, Math.round(value)])), artifactBytes: finished.snapshot?.artifacts?.reduce((sum, artifact) => sum + artifact.size, 0) ?? 0, artifactCount: finished.artifactCount, metrics: finished.buildMetrics, processPeakRssMb: Math.ceil(process.resourceUsage().maxRSS / 1024), interrupted, ready: finished.status === 'ready' };
        results.push(measurement);
        if (output) await fs.writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), scope: 'real candidate builder; no activation; no queue latency', status: 'in-progress', results }, null, 2) + '\n');
        process.stderr.write(`${count} ${kind} completed in ${measurement.elapsedMs}ms\n`);
        return finished;
      };
      const full = await createCandidate('Full baseline', null);
      await measure('full', full);
      await db.update(schema.cmsPages).set({ blocks: [{ id: 'text', type: 'richtext', props: { html: '<p>Edited independent page.</p>' } }] }).where(eq(schema.cmsPages.id, page.id));
      await measure('incremental-independent-page', await createCandidate('Incremental baseline', full.deployment.id));
      const revision = await db.transaction(async (tx) => {
        const [article] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.siteId, site.id)).orderBy(schema.cmsContents.id).limit(1);
        const working = await initializeCmsContentWorkingCopy(tx, article);
        const frozen = await freezeCmsContentRevision(tx, article, { ...working, snapshot: { ...working.snapshot, body: body + '<p>One article body edit.</p>' } }, 'publication', 'Scale benchmark body-only revision');
        await tx.insert(schema.cmsContentRevisionApprovals).values({ revisionId: frozen.id, hash: frozen.hash });
        return frozen;
      });
      const bodyCandidate = await createCandidate('One approved article body edit', full.deployment.id, revision);
      const incremental = await measure('incremental-one-article-body', bodyCandidate);
      if ((incremental.buildMetrics.reusedArtifacts ?? 0) < count - 1) throw new Error('Body-only change rebuilt unrelated default detail pages');
      const expectedArtifacts = new Map(incremental.snapshot!.artifacts!.map((artifact) => [artifact.path, artifact.checksum]));
      const expectedRoot = path.join(root, 'parity', String(incremental.id));
      for (const artifact of incremental.snapshot!.artifacts!) {
        const destination = path.resolve(expectedRoot, artifact.path);
        if (!isStrictlyWithin(expectedRoot, destination)) throw new Error('Invalid artifact in parity manifest');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(await cmsBuildArtifactFile(site.code, incremental.id, artifact.path), destination);
      }
      const forced = await measure('same-frozen-input-forced-full', { ...bodyCandidate, deployment: incremental }, undefined, true);
      const differences = forced.snapshot!.artifacts!.filter((artifact) => expectedArtifacts.get(artifact.path) !== artifact.checksum).map((artifact) => artifact.path);
      for (const artifact of forced.snapshot!.artifacts!) {
        if (!expectedArtifacts.has(artifact.path)) continue;
        const [expected, actual] = await Promise.all([fs.readFile(path.resolve(expectedRoot, artifact.path)), fs.readFile(await cmsBuildArtifactFile(site.code, forced.id, artifact.path))]);
        if (!expected.equals(actual) && !differences.includes(artifact.path)) differences.push(artifact.path);
      }
      if (differences.length || forced.snapshot!.artifacts!.length !== expectedArtifacts.size) throw new Error(`Full/incremental artifact bytes differ: ${differences.slice(0, 10).join(',')}`);
      results.push({ articles: count, kind: 'full-incremental-byte-parity', comparedFiles: expectedArtifacts.size, comparison: 'all artifact bytes plus manifest checksums', identical: true });
      await measure('interrupted-and-resumed', await createCandidate('Resume baseline', full.deployment.id, revision), Math.floor(count / 2));
      if (output) await fs.writeFile(output, JSON.stringify({ measuredAt: new Date().toISOString(), scope: 'real candidate builder; no activation; no queue latency', results }, null, 2) + '\n');
    }
  });
  const evidence = JSON.stringify({ measuredAt: new Date().toISOString(), scope: 'real candidate builder; no activation; no queue latency', node: process.version, platform: process.platform, results }, null, 2) + '\n';
  if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, evidence); }
  process.stdout.write(evidence);
} catch (error) { buildError = error; throw error; } finally {
  const cleanupErrors: unknown[] = [];
  const cleanup = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { cleanupErrors.push(error); } };
  for (const id of generations) {
    await cleanup(() => db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${cmsBuildSchema(id)}" CASCADE`)));
    await cleanup(() => db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${cmsGenerationSchemaName(id)}" CASCADE`)));
  }
  await cleanup(async () => {
    // Dependencies are deleted in one transaction; no immutable-history trigger is disabled.
    await db.transaction(async (tx) => {
      if (generations.length) await tx.delete(schema.cmsDeployments).where(inArray(schema.cmsDeployments.id, generations));
      if (sites.length) {
        await tx.delete(schema.cmsReleases).where(inArray(schema.cmsReleases.siteId, sites));
        await tx.execute(sql`DELETE FROM public.cms_content_revision_approvals WHERE revision_id IN (SELECT revision.id FROM public.cms_content_revisions revision JOIN public.cms_contents content ON content.id=revision.content_id WHERE content.site_id IN (${sql.join(sites.map((id) => sql`${id}`), sql`,`)}))`);
        await tx.delete(schema.cmsSites).where(inArray(schema.cmsSites.id, sites));
      }
      if (userId) await tx.delete(schema.users).where(eq(schema.users.id, userId));
    });
  });
  await cleanup(closeRedis); await cleanup(closeDb);
  await cleanup(() => fs.rm(root, { recursive: true, force: true }));
  if (cleanupErrors.length) throw new AggregateError([...(buildError ? [buildError] : []), ...cleanupErrors], `Benchmark cleanup failed; fixture site IDs: ${sites.join(',')}; generation IDs: ${generations.join(',')}; user ID: ${userId}`);
}
