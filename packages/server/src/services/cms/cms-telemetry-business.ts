import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { cmsTelemetryConversionContextSchema, type CmsTelemetryBusinessPayload, type CmsTelemetryConversionContext, type CmsTelemetryPageContext } from '@arcbase/shared/cms';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { analyticsSites, cmsDeployments, cmsSites, cmsTelemetryOutbox, cmsTelemetryReceipts, userEvents } from '../../db/schema';
import { verifyCmsTelemetryPageToken } from './cms-telemetry-context';
import { cmsGenerationContext } from './cms-generation-context';

type BusinessType = 'form' | 'vote' | 'comment' | 'follow' | 'download';
const names = { form: 'cms.form_complete', vote: 'cms.vote_complete', comment: 'cms.comment_complete', follow: 'cms.follow_complete', download: 'cms.download_delivered' } as const;
function eventId(siteId: number, name: string, referenceId: string): string {
  const bytes=createHash('sha256').update(`cms-telemetry-v2:${siteId}:${name}:${referenceId}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function parseContext(raw: unknown): CmsTelemetryConversionContext | null {
  try { const parsed=cmsTelemetryConversionContextSchema.safeParse(typeof raw==='string'?JSON.parse(raw):raw);return parsed.success?parsed.data:null; }catch{return null;}
}

/** The outbox belongs to the successful business transaction, so delivery failure cannot lose a conversion. */
export async function enqueueCmsTelemetryConversion(tx: DbTransaction,siteId: number,type: BusinessType,referenceId: string|number,raw: unknown,memberId?: number|null,targetId?: string,targetName?: string,media?:Pick<CmsTelemetryBusinessPayload,'resourceId'|'assetVersionId'>): Promise<void> {
  if(cmsGenerationContext()?.candidate)return;
  const [site]=await tx.select({settings:cmsSites.settings,status:cmsSites.status}).from(cmsSites).where(eq(cmsSites.id,siteId)).limit(1);
  const settings=site?.settings?.telemetry as {enabled?:boolean;schemaVersion?:number}|undefined;
  if(site?.status!=='enabled'||!settings?.enabled||settings.schemaVersion!==2)return;
  let context=parseContext(raw);let page:CmsTelemetryPageContext|null=context?verifyCmsTelemetryPageToken(context.contextToken):null;
  if(!page||page.siteId!==siteId||page.environment!=='live'||page.siteKey!==site.settings?.analyticsSiteKey){context=null;page=null;}
  if(page){
    const [deployment]=page.deploymentId?await tx.select({releaseId:cmsDeployments.releaseId,activatedAt:cmsDeployments.activatedAt}).from(cmsDeployments).where(and(eq(cmsDeployments.id,page.deploymentId),eq(cmsDeployments.siteId,siteId))).limit(1):[];
    if(!deployment?.activatedAt||deployment.releaseId!==page.releaseId){context=null;page=null;}
  }
  const payload:CmsTelemetryBusinessPayload={name:names[type],referenceId:String(referenceId),targetId:targetId??`${type}:${referenceId}`,...(targetName?{targetName}:{}),...media,occurredAt:new Date().toISOString(),memberId:memberId??null,context,page};
  await tx.insert(cmsTelemetryOutbox).values({siteId,eventId:eventId(siteId,payload.name,payload.referenceId),payload}).onConflictDoNothing({target:cmsTelemetryOutbox.eventId});
}

async function originProperties(tx:DbTransaction,siteId:number,payload:CmsTelemetryBusinessPayload):Promise<Record<string,unknown>>{
  const context=payload.context;if(!context)return {};
  const trusted=JSON.stringify({cmsSchemaVersion:2,cmsSiteId:siteId,trustedCms:true,environment:'live',visitorId:context.visitorId,sessionId:context.sessionId});
  const [origin]=await tx.execute<{properties:Record<string,unknown>}>(sql`select properties from public.user_events where tenant_id is null and properties @> ${trusted}::jsonb
    and event_name='cms.page_view' and nullif(properties->>'contentId','') is not null
    and created_at<=${payload.occurredAt}::timestamptz and created_at>${payload.occurredAt}::timestamptz-interval '30 minutes'
    order by created_at desc,id desc limit 1`);
  if(!origin)return {};
  const properties:Record<string,unknown>={};
  for(const key of ['contentId','contentTitle','channelId','channelName','author','contentType','revisionId','releaseId','deploymentId']){
    if(origin.properties[key]!=null)properties[`origin${key[0].toUpperCase()}${key.slice(1)}`]=origin.properties[key];
  }
  const [search]=await tx.execute<{properties:Record<string,unknown>}>(sql`select properties from public.user_events where tenant_id is null and properties @> ${trusted}::jsonb
    and event_name='cms.search_click' and properties->>'targetContentId'=${String(origin.properties.contentId)}
    and created_at<=${payload.occurredAt}::timestamptz and created_at>${payload.occurredAt}::timestamptz-interval '30 minutes'
    order by created_at desc,id desc limit 1`);
  if(search)for(const key of ['searchId','keyword','resultCount'])if(search.properties[key]!=null)properties[key]=search.properties[key];
  return properties;
}

async function deliver(tx:DbTransaction,row:typeof cmsTelemetryOutbox.$inferSelect):Promise<boolean>{
  const {payload}=row;const page=payload.page;const context=payload.context;
  const [app]=await tx.select({appId:analyticsSites.appId}).from(cmsSites).innerJoin(analyticsSites,and(sql`${cmsSites.settings}->>'analyticsSiteKey'=${analyticsSites.siteKey}`,isNull(analyticsSites.tenantId))).where(eq(cmsSites.id,row.siteId)).limit(1);
  const now=new Date();
  const targetFields=payload.targetId.startsWith('form:')?{formId:payload.targetId.slice(5),formName:payload.targetName}:payload.targetId.startsWith('interaction:')?{interactionId:Number(payload.targetId.slice(12)),interactionName:payload.targetName}:{};
  const properties:Record<string,unknown>={cmsSchemaVersion:2,cmsSiteId:row.siteId,trustedCms:true,environment:'live',receivedAt:now.toISOString(),referenceId:payload.referenceId,targetId:payload.targetId,targetName:payload.targetName,...targetFields,
    ...(payload.resourceId?{resourceId:payload.resourceId,assetVersionId:payload.assetVersionId,resourceName:payload.targetName}:{}),
    ...(page?{contentId:page.contentId,contentTitle:page.contentTitle,channelId:page.channelId,channelName:page.channelName,contentType:page.contentType,author:page.author,revisionId:page.revisionId,releaseId:page.releaseId,deploymentId:page.deploymentId,pageType:page.pageType,canonicalPath:page.canonicalPath}:{}),
    ...(context?{visitorId:context.visitorId,sessionId:context.sessionId,pageViewId:context.pageViewId,entryPath:context.entryPath,entrySource:context.entrySource,
      ...(context.utm?{utmSource:context.utm.source,utmMedium:context.utm.medium,utmCampaign:context.utm.campaign,utmTerm:context.utm.term,utmContent:context.utm.content}:{}),...await originProperties(tx,row.siteId,payload)}:{entrySource:'unattributed',entryPath:'/',attributionReason:'missing_or_invalid_context'}),
  };
  const inserted=await tx.insert(userEvents).values({eventId:row.eventId,tenantId:null,distinctId:payload.memberId?`m:${payload.memberId}`:context?.visitorId??null,anonymousId:context?.visitorId??null,sessionId:context?.sessionId??null,
    memberId:payload.memberId,source:'server',appId:app?.appId??`cms-${row.siteId}`,environment:'production',eventType:'custom',eventName:payload.name,pagePath:page?.canonicalPath.slice(0,256)??'/server/cms',pageTitle:page?.contentTitle?.slice(0,128)??null,createdAt:new Date(payload.occurredAt),properties,
  }).onConflictDoNothing({target:userEvents.eventId}).returning({id:userEvents.id});
  await tx.update(cmsTelemetryOutbox).set({deliveredAt:now,lastError:null,attempts:sql`${cmsTelemetryOutbox.attempts}+1`}).where(eq(cmsTelemetryOutbox.id,row.id));
  await tx.insert(cmsTelemetryReceipts).values({siteId:row.siteId,accepted:inserted.length,duplicates:inserted.length?0:1,rejected:0,reason:'business_outbox'});
  return inserted.length>0;
}

/** Each delivery uses a savepoint: one bad event cannot poison or block the remaining locked batch. */
export async function drainCmsTelemetryOutbox():Promise<{delivered:number;failed:number;duplicates:number}>{
  return db.transaction(async tx=>{
    const rows=await tx.select().from(cmsTelemetryOutbox).where(isNull(cmsTelemetryOutbox.deliveredAt)).orderBy(cmsTelemetryOutbox.attempts,cmsTelemetryOutbox.id).limit(100).for('update',{skipLocked:true});
    const result={delivered:0,failed:0,duplicates:0};
    for(const row of rows){
      try{const fresh=await tx.transaction(savepoint=>deliver(savepoint,row));result.delivered++;if(!fresh)result.duplicates++;}
      catch(error){await tx.update(cmsTelemetryOutbox).set({attempts:sql`${cmsTelemetryOutbox.attempts}+1`,lastError:(error instanceof Error?error.message:String(error)).slice(0,2000)}).where(eq(cmsTelemetryOutbox.id,row.id));result.failed++;}
    }
    return result;
  });
}
