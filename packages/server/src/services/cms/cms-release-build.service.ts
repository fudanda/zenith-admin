import { and, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsDeploymentBuildPlan, CmsDeploymentBuildMetrics } from '@arcbase/shared/cms';
import { db, withDbExecutor, withoutDbExecutor } from '../../db';
import { cmsChannels, cmsContents, cmsContentRevisions, cmsContentWorkingCopies, cmsDeployments, cmsReleases, cmsSites, type CmsReleaseRow, type CmsDeploymentRow, type CmsDeploymentSnapshot } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { TaskCancelledError } from '../../lib/task-center';
import type { TaskRunContext } from '../../lib/task-center/types';
import { applyCmsRevisionProjection, loadCmsPublishableRevision } from './cms-content-revisions.service';
import { withCmsGenerationContext } from './cms-generation-context';
import { cmsGenerationManifest, cmsGenerationSchemaName, collectCmsGenerationArtifacts, createCmsGenerationStorage, hashCmsDeploymentManifest, sealCmsGenerationStorage, verifyCmsGenerationArtifacts } from './cms-generation-storage.service';
import { assertCmsReleaseDependencies } from './cms-release-preflight.service';
import { buildSiteStatic, writeStaticFile } from './cms-static.service';
import { withCmsStaticWriteFence } from './cms-site-publish-lock.service';
import { rebuildSearchIndex, reloadCmsSearchDict, releaseCmsGenerationSearchDictionary } from './cms-search.service';
import { cmsBuildDependencyHashes, cmsBuildRuntimeHash, createCmsBuildStorage, loadCmsBuildTargets, saveCmsBuildTarget, withCmsBuildTransaction } from './cms-release-build-storage';
import { cmsBuildTargetFingerprint, inspectCmsBuildArtifacts, reuseCmsBuildTarget, validateCmsBuildTarget, type CmsBuildTarget } from './cms-release-build-artifacts';
import { ensureSiteIslandsAsset, ensureSiteThemeCssAsset } from './cms-render.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';

export function newCmsDeploymentBuildPlan(): CmsDeploymentBuildPlan {
  return { version: 1, phases: [
    { key: 'projection', label: '生成公开投影', dependsOn: [], status: 'pending', processed: 0, total: 1 },
    { key: 'search', label: '重建搜索索引', dependsOn: ['projection'], status: 'pending', processed: 0, total: 0 },
    { key: 'static', label: '生成静态页面', dependsOn: ['projection', 'search'], status: 'pending', processed: 0, total: 0 },
    { key: 'manifest', label: '校验并封存产物', dependsOn: ['static'], status: 'pending', processed: 0, total: 1 },
  ] };
}

type ExecutionGuard = (tx: DbTransaction) => Promise<void>;

/** Short committed phases make the frozen projection and each artifact recoverable independently. */
export async function buildCmsReleaseCandidate(release: CmsReleaseRow, deployment: CmsDeploymentRow, ctx: TaskRunContext, guard: ExecutionGuard, options?: { forceFull?: boolean }): Promise<void> {
  const generationId = deployment.id;
  const reportCompleted = async () => {
    const result = await withoutDbExecutor(() => ctx.progress({ processed: 1, total: 1, note: '候选部署构建完成', checkpoint: { generationId, phase: 'completed' } }));
    if (result.cancelRequested) throw new TaskCancelledError('发布执行轮次已失效或已取消');
  };
  const sealed = deployment.status === 'ready';
  if (options?.forceFull && (!sealed || release.status !== 'building')) throw new Error('强制全量校验仅允许尚未激活的固定候选部署');
  if (sealed && !options?.forceFull) {
    if (!deployment.snapshot) throw new Error('候选部署缺少清单');
    await verifyCmsGenerationArtifacts(generationId, deployment.snapshot);
    await reportCompleted();
    return;
  }
  const plan = deployment.buildPlan.phases.length ? deployment.buildPlan : newCmsDeploymentBuildPlan();
  delete plan.failedTargetKey;
  const startedAt = deployment.buildMetrics.startedAt ?? new Date().toISOString();
  const metrics: CmsDeploymentBuildMetrics = { ...deployment.buildMetrics, startedAt, attempts: ctx.attempt, generatedArtifacts: 0, reusedArtifacts: 0, resumedArtifacts: 0 };
  const peak = () => { metrics.peakMemoryMb = Math.max(metrics.peakMemoryMb ?? 0, Math.ceil(process.memoryUsage().rss / 1024 / 1024)); };
  const assertCurrent = async () => {
    if (await withoutDbExecutor(() => ctx.isCancelRequested())) throw new TaskCancelledError('发布执行轮次已失效或已取消');
    const [row] = await withoutDbExecutor(() => db.select({ status: cmsReleases.status, deploymentId: cmsReleases.deploymentId }).from(cmsReleases).where(eq(cmsReleases.id, release.id)).limit(1));
    if (row?.status !== 'building' || row.deploymentId !== generationId) throw new TaskCancelledError('发布单已取消或已由其他部署接管');
  };
  const persist = async (tx: DbTransaction) => {
    peak();
    await guard(tx);
    await tx.update(cmsDeployments).set({ buildPlan: plan, buildMetrics: metrics, error: null, status: 'building' }).where(eq(cmsDeployments.id, generationId));
  };
  const phase = (key: string, status: 'running' | 'completed', processed?: number, total?: number) => {
    const row = plan.phases.find((entry) => entry.key === key)!;
    row.status = status;
    if (processed !== undefined) row.processed = processed;
    if (total !== undefined) row.total = total;
    return row;
  };
  const progress = async (key: string, note: string, processed: number, total: number, targetKey?: string) => {
    phase(key, 'running', processed, total);
    if (targetKey) plan.lastTargetKey = targetKey;
    const result = await withoutDbExecutor(() => ctx.progress({ note, processed, total, checkpoint: { generationId, phase: key, lastTargetKey: plan.lastTargetKey ?? null, frozenAt: plan.frozenAt ?? null } }));
    if (result.cancelRequested) throw new TaskCancelledError('发布执行轮次已失效或已取消');
    await assertCurrent();
    await withoutDbExecutor(() => db.transaction(persist));
  };

  try {
    if (!plan.frozenAt) {
      await progress('projection', '冻结发布输入与公开投影', 0, 1);
      const buildAt = new Date();
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-generation-build'), ${generationId})`);
        await createCmsGenerationStorage(tx, release.siteId, generationId, release.baseGenerationId, release.configurationSnapshot);
        const revisions: Awaited<ReturnType<typeof loadCmsPublishableRevision>>[] = [];
        for (const item of release.items) if (item.revisionId) revisions.push(await loadCmsPublishableRevision(tx, item.revisionId));
        const [base] = release.baseGenerationId ? await tx.select({ snapshot: cmsDeployments.snapshot }).from(cmsDeployments).where(eq(cmsDeployments.id, release.baseGenerationId)).limit(1) : [];
        const existingRevisions = base?.snapshot?.revisions ?? await tx.select({ contentId: cmsContentWorkingCopies.contentId, revisionId: cmsContentRevisions.id, hash: cmsContentRevisions.hash })
          .from(cmsContentWorkingCopies).innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
          .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.publishedRevisionId)).where(eq(cmsContents.siteId, release.siteId));
        const revisionMap = new Map(existingRevisions.map((entry) => [entry.contentId, entry]));
        const schema = cmsGenerationSchemaName(generationId);
        // New identities are inserted only for explicitly pinned revisions; unrelated live rows never enter the base.
        if (revisions.length) {
          const columns = await tx.execute<{ name: string }>(sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='cms_contents' AND is_generated='NEVER' ORDER BY ordinal_position`);
          const names = columns.map(({ name }) => { if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid projection column'); return `"${name}"`; }).join(',');
          await tx.execute(sql`INSERT INTO ${sql.raw(`"${schema}".cms_contents (${names})`)} OVERRIDING SYSTEM VALUE SELECT ${sql.raw(names)} FROM public.cms_contents WHERE id IN (${sql.join(revisions.map((revision) => sql`${revision.contentId}`), sql`,`)}) ON CONFLICT (id) DO NOTHING`);
        }
        await tx.execute(sql`select set_config('search_path', ${`${schema},public`}, true)`);
        await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: release.siteId, generationId, candidate: true, buildAt }, async () => {
          for (const revision of revisions) {
            const [channel] = await tx.select({ id: cmsChannels.id }).from(cmsChannels).where(and(eq(cmsChannels.siteId, release.siteId), eq(cmsChannels.id, revision.payload.channelId), eq(cmsChannels.status, 'enabled'))).limit(1);
            if (!channel) throw new HTTPException(409, { message: '修订目标栏目未包含在候选公开配置中，请将栏目配置一并发布' });
            const [previous] = await tx.select({ publishedAt: cmsContents.publishedAt, status: cmsContents.status }).from(cmsContents).where(eq(cmsContents.id, revision.contentId)).limit(1);
            // Editing a published article does not move it in date-sorted lists or change its URL.
            const publishedAt = release.activateAt ?? (previous?.status === 'published' ? previous.publishedAt : null) ?? buildAt;
            await applyCmsRevisionProjection(tx, revision, { publishedAt, generationId, candidate: true });
            revisionMap.set(revision.contentId, { contentId: revision.contentId, revisionId: revision.id, hash: revision.hash });
          }
          const withdrawIds = release.items.filter((item) => item.action === 'withdraw').map((item) => item.contentId);
          if (withdrawIds.length) await tx.update(cmsContents).set({ status: 'offline' }).where(inArray(cmsContents.id, withdrawIds));
          await assertCmsReleaseDependencies(tx, release.siteId);
        }));
        await createCmsBuildStorage(tx, release.siteId, generationId);
        const manifest = await cmsGenerationManifest(tx, generationId, [...revisionMap.values()].sort((a, b) => a.contentId - b.contentId));
        const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, release.siteId)).limit(1);
        manifest.snapshot.siteCode = site.code;
        manifest.snapshot.sitePublicRevision = site.publicRevision;
        manifest.snapshot.createdAt = buildAt.toISOString();
        plan.frozenAt = buildAt.toISOString(); plan.baseGenerationId = release.baseGenerationId;
        phase('projection', 'completed', 1, 1);
        await assertCurrent();
        await persist(tx);
        await tx.update(cmsDeployments).set({ snapshot: manifest.snapshot }).where(eq(cmsDeployments.id, generationId));
      }, { isolationLevel: 'repeatable read' });
    }

    const buildAt = new Date(plan.frozenAt!);
    if (plan.phases.find((row) => row.key === 'search')?.status !== 'completed') {
      await progress('search', '重建候选搜索索引', 0, 0);
      await withCmsBuildTransaction(release.siteId, generationId, buildAt, async () => {
        await reloadCmsSearchDict(release.siteId);
        const total = await rebuildSearchIndex({ siteId: release.siteId, onProgress: async (processed, count) => { await progress('search', `搜索索引 ${processed}/${count}`, processed, count); } });
        phase('search', 'completed', total, total);
      });
      await db.transaction(persist);
    }

    await progress('static', '校验断点并构建候选页面', 0, 0);
    const currentTargets = options?.forceFull ? new Map<string, CmsBuildTarget>() : await loadCmsBuildTargets(generationId);
    const baseTargets = release.baseGenerationId && !options?.forceFull ? await loadCmsBuildTargets(release.baseGenerationId) : new Map<string, CmsBuildTarget>();
    const runtimeHash = await cmsBuildRuntimeHash();
    const seenTargets = new Set<string>();
    await withCmsBuildTransaction(release.siteId, generationId, buildAt, async (tx) => {
      const site = await resolveEffectiveCmsSiteRow(release.siteId);
      const dependencies = await cmsBuildDependencyHashes(tx, generationId, buildAt, runtimeHash);
      await withCmsStaticWriteFence(assertCurrent, () => buildSiteStatic(release.siteId, async (update) => {
        await progress('static', update.note, update.processed, update.total, update.checkpoint.lastKey);
      }, { runTarget: async (key, render) => {
        try {
          await assertCurrent();
          seenTargets.add(key);
          const fingerprint = cmsBuildTargetFingerprint(dependencies.global, key, dependencies.pages, plan.frozenAt, dependencies.contents);
          const completed = currentTargets.get(key);
          if (completed?.fingerprint === fingerprint && await validateCmsBuildTarget(site.code, generationId, completed)) {
            metrics.resumedArtifacts = (metrics.resumedArtifacts ?? 0) + completed.artifacts.length;
            return completed.artifacts.map((artifact) => artifact.path);
          }
          const base = baseTargets.get(key);
          let artifacts = base?.fingerprint === fingerprint && release.baseGenerationId
            ? await reuseCmsBuildTarget({ siteCode: site.code, sourceGenerationId: release.baseGenerationId, generationId, releaseId: release.id, target: base, assertCurrent }) : null;
          if (artifacts) metrics.reusedArtifacts = (metrics.reusedArtifacts ?? 0) + artifacts.length;
          else {
            artifacts = await inspectCmsBuildArtifacts(site.code, generationId, await render());
            metrics.generatedArtifacts = (metrics.generatedArtifacts ?? 0) + artifacts.length;
          }
          const target = { key, fingerprint, artifacts };
          await withoutDbExecutor(() => db.transaction(async (tx) => { await guard(tx); await saveCmsBuildTarget(tx, generationId, target); }));
          return artifacts.map((artifact) => artifact.path);
        } catch (error) {
          if (error instanceof TaskCancelledError) throw error;
          plan.failedTargetKey = key;
          await withoutDbExecutor(() => db.transaction(persist)).catch(() => undefined);
          throw new Error(`构建目标 ${key} 失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      } }));
      // Shared assets are not owned by a page target and must exist even when every page was reused.
      await assertCurrent();
      const theme = await ensureSiteThemeCssAsset(site);
      const islands = await ensureSiteIslandsAsset(site);
      await withCmsStaticWriteFence(assertCurrent, async () => {
        await writeStaticFile(site.code, `_assets/theme.${theme.hash}.css`, theme.css);
        await writeStaticFile(site.code, islands.relPath, islands.js);
      });
      metrics.generatedArtifacts = (metrics.generatedArtifacts ?? 0) + 2;
    });
    await db.transaction(async (tx) => {
      await guard(tx);
      if (seenTargets.size) await tx.execute(sql`DELETE FROM ${sql.raw(`"${cmsGenerationSchemaName(generationId)}".cms_build_targets`)} WHERE key NOT IN (${sql.join([...seenTargets].map((key) => sql`${key}`), sql`,`)})`);
    });
    const staticPhase = plan.phases.find((row) => row.key === 'static')!;
    phase('static', 'completed', staticPhase.total, staticPhase.total);
    await progress('manifest', '核对完整产物清单并封存候选部署', 0, 1);
    await withCmsBuildTransaction(release.siteId, generationId, buildAt, async (tx) => {
      const [stored] = await tx.select({ snapshot: cmsDeployments.snapshot }).from(cmsDeployments).where(eq(cmsDeployments.id, generationId)).limit(1);
      const manifest = await cmsGenerationManifest(tx, generationId, stored.snapshot!.revisions, sealed);
      const snapshot: CmsDeploymentSnapshot = { ...manifest.snapshot, siteCode: stored.snapshot!.siteCode, sitePublicRevision: stored.snapshot!.sitePublicRevision, createdAt: plan.frozenAt! };
      snapshot.artifacts = await collectCmsGenerationArtifacts(snapshot.siteCode!, generationId, async (count) => {
        const result = await withoutDbExecutor(() => ctx.progress({ note: `核对产物 ${count} 个`, checkpoint: { generationId, phase: 'manifest', frozenAt: plan.frozenAt } }));
        if (result.cancelRequested) throw new TaskCancelledError('发布执行轮次已失效或已取消');
      });
      const targets = await withoutDbExecutor(() => loadCmsBuildTargets(generationId));
      let checked = 0;
      for (const target of targets.values()) {
        if (!await validateCmsBuildTarget(snapshot.siteCode!, generationId, target)) throw new Error(`构建产物校验失败：${target.key}`);
        if (++checked % 100 === 0) {
          const result = await withoutDbExecutor(() => ctx.progress({ note: `校验构建目标 ${checked}/${targets.size}`, checkpoint: { generationId, phase: 'manifest', frozenAt: plan.frozenAt } }));
          if (result.cancelRequested) throw new TaskCancelledError('发布执行轮次已失效或已取消');
        }
      }
      await assertCurrent();
      if (!sealed) await sealCmsGenerationStorage(tx, generationId, snapshot.revisions);
      phase('manifest', 'completed', 1, 1);
      peak();
      metrics.completedAt = new Date().toISOString(); metrics.elapsedMs = Date.now() - new Date(startedAt).getTime();
      await guard(tx);
      await tx.update(cmsDeployments).set({ status: 'ready', error: null, snapshot, manifestHash: hashCmsDeploymentManifest(snapshot), artifactCount: snapshot.artifacts.length, buildPlan: plan, buildMetrics: metrics }).where(eq(cmsDeployments.id, generationId));
    }, 'read committed');
    await reportCompleted();
  } finally { releaseCmsGenerationSearchDictionary(generationId); }
}
