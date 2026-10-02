import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { CmsTelemetryConversionContext, CmsTelemetryPageContext } from '@arcbase/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { signCmsTelemetryPage } from './cms-telemetry-context';
import { drainCmsTelemetryOutbox, enqueueCmsTelemetryConversion } from './cms-telemetry-business';

const connection=process.env.TEST_DATABASE_URL;
const client=connection?postgres(connection,{max:1,onnotice:()=>undefined}):null;
afterAll(async()=>{await client?.end();});
describe.skipIf(!connection)('CMS business telemetry transactional outbox',()=>{
  it('rolls back with the business transaction, retries failures, deduplicates delivery and derives the last trusted origin',async()=>{
    const url=new URL(connection!);
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/arcbase_review')throw new Error('Requires disposable local arcbase_review database');
    const testDb=drizzle(client!,{schema,casing:'snake_case'});const rollback=new Error('rollback outbox fixture');
    try{
      await testDb.transaction(async tx=>withDbExecutor(tx,async()=>{
        const suffix=randomUUID().slice(0,8);const siteKey=`qa-business-${suffix}`;
        const [site]=await tx.insert(schema.cmsSites).values({code:siteKey,name:siteKey,theme:'default',settings:{analyticsSiteKey:siteKey,telemetry:{enabled:true,schemaVersion:2,timeZone:'Asia/Shanghai'}}}).returning();
        await tx.insert(schema.analyticsSites).values({siteKey,appId:siteKey,name:siteKey});
        const [release]=await tx.insert(schema.cmsReleases).values({siteId:site.id,name:'QA release'}).returning();
        const [deployment]=await tx.insert(schema.cmsDeployments).values({siteId:site.id,releaseId:release.id,status:'active',activatedAt:new Date()}).returning();
        const page:CmsTelemetryPageContext={version:2,siteId:site.id,siteKey,environment:'live',canonicalPath:'/contact/',pageType:'page',contentId:null,channelId:2,revisionId:null,contentType:null,contentTitle:null,channelName:'Contact',author:null,releaseId:release.id,deploymentId:deployment.id};
        const context:CmsTelemetryConversionContext={contextToken:signCmsTelemetryPage(page).contextToken,visitorId:randomUUID(),sessionId:randomUUID(),pageViewId:randomUUID(),entryPath:'/news/first.html',entrySource:'newsletter',lastContentId:999999,utm:{source:'newsletter',campaign:'qa'}};
        const props={cmsSiteId:site.id,cmsSchemaVersion:2,trustedCms:true,environment:'live',visitorId:context.visitorId,sessionId:context.sessionId};
        const now=Date.now();const searchId=randomUUID();
        await tx.insert(schema.userEvents).values([
          {eventId:randomUUID(),eventType:'page_view',eventName:'cms.page_view',pagePath:'/news/trusted.html',createdAt:new Date(now-5000),properties:{...props,pageViewId:randomUUID(),contentId:101,contentTitle:'Trusted article',channelId:201,channelName:'Culture',author:'QA Author',contentType:'article',revisionId:301,releaseId:release.id,deploymentId:deployment.id}},
          {eventId:randomUUID(),eventType:'page_view',eventName:'cms.page_view',pagePath:'/news/forged.html',createdAt:new Date(now-1000),properties:{...props,trustedCms:false,contentId:999999}},
          {eventId:randomUUID(),eventType:'custom',eventName:'cms.search_click',pagePath:'/search',createdAt:new Date(now-6000),properties:{...props,targetContentId:101,searchId,keyword:'culture',resultCount:3}},
        ]);
        const abort=new Error('abort business');
        await expect(tx.transaction(async nested=>{await enqueueCmsTelemetryConversion(nested,site.id,'form','aborted',context,null,'form:5');throw abort;})).rejects.toBe(abort);
        expect(await tx.$count(schema.cmsTelemetryOutbox,eq(schema.cmsTelemetryOutbox.siteId,site.id))).toBe(0);
        await enqueueCmsTelemetryConversion(tx,site.id,'form','success',context,null,'form:5','Readers');
        await enqueueCmsTelemetryConversion(tx,site.id,'form','success',context,null,'form:5','Readers');
        await enqueueCmsTelemetryConversion(tx,site.id,'vote','invalid-context',{visitorId:'forged'},null,'interaction:8','Vote');
        expect(await tx.$count(schema.cmsTelemetryOutbox,eq(schema.cmsTelemetryOutbox.siteId,site.id))).toBe(2);
        const result=await drainCmsTelemetryOutbox();expect(result.failed).toBe(0);expect(result.delivered).toBeGreaterThanOrEqual(2);
        const events=await tx.select().from(schema.userEvents).where(sql`${schema.userEvents.properties}->>'cmsSiteId'=${String(site.id)} and ${schema.userEvents.source}='server'`);
        expect(events).toHaveLength(2);
        const success=events.find(row=>row.eventName==='cms.form_complete')!;
        expect(success.properties).toMatchObject({trustedCms:true,originContentId:101,originContentTitle:'Trusted article',originChannelId:201,originAuthor:'QA Author',visitorId:context.visitorId,searchId,keyword:'culture',formId:'5'});
        const invalid=events.find(row=>row.eventName==='cms.vote_complete')!;
        expect(invalid.anonymousId).toBeNull();expect(invalid.sessionId).toBeNull();expect(invalid.properties).toMatchObject({entrySource:'unattributed',attributionReason:'missing_or_invalid_context'});
        expect(invalid.properties).not.toHaveProperty('visitorId');
        const [outbox]=await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.eventId,success.eventId!));
        await tx.update(schema.cmsTelemetryOutbox).set({deliveredAt:null}).where(eq(schema.cmsTelemetryOutbox.id,outbox.id));
        const duplicate=await drainCmsTelemetryOutbox();expect(duplicate.duplicates).toBeGreaterThanOrEqual(1);
        expect(await tx.$count(schema.userEvents,eq(schema.userEvents.eventId,success.eventId!))).toBe(1);
        await enqueueCmsTelemetryConversion(tx,site.id,'form','retry',context,2147483647,'form:5');
        const failed=await drainCmsTelemetryOutbox();expect(failed.failed).toBeGreaterThanOrEqual(1);
        const [pending]=await tx.select().from(schema.cmsTelemetryOutbox).where(sql`${schema.cmsTelemetryOutbox.siteId}=${site.id} and ${schema.cmsTelemetryOutbox.payload}->>'referenceId'='retry'`);
        expect(pending.deliveredAt).toBeNull();expect(pending.attempts).toBe(1);expect(pending.lastError).toBeTruthy();
        await tx.update(schema.cmsTelemetryOutbox).set({payload:{...pending.payload,memberId:null}}).where(eq(schema.cmsTelemetryOutbox.id,pending.id));
        expect((await drainCmsTelemetryOutbox()).failed).toBe(0);
        expect((await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.id,pending.id)))[0].deliveredAt).not.toBeNull();
        throw rollback;
      }));
    }catch(error){if(error!==rollback)throw error;}
  },60000);
});
