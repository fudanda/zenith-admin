import { SEED_REPORT_ASSET_TEMPLATES, SEED_REPORT_DQ_RULES, SEED_REPORT_ENVIRONMENTS, SEED_REPORT_FILL_TEMPLATES, SEED_REPORT_FOLDERS, SEED_REPORT_METRICS, SEED_REPORT_QUERY_QUOTAS, SEED_REPORT_SLA_RULES } from '@arcbase/shared/seed';
import type { ReportAssetTemplate, ReportChatbiMessage, ReportChatbiSession, ReportDeprecationNotice, ReportDqAnomaly, ReportDqRule, ReportDqRun, ReportDqScore, ReportEnvironment, ReportEnvironmentPromotion, ReportFillRecord, ReportFillTemplate, ReportFolder, ReportMaterializationSnapshot, ReportMetric, ReportPublishApproval, ReportQueryCostLog, ReportQueryQuota, ReportResourceAcl, ReportResourceTransfer, ReportSlaRule, ReportSlaViolation } from '@arcbase/shared/report';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const mockReportFolders: ReportFolder[] = clone(SEED_REPORT_FOLDERS);
export const mockReportEnvironments: ReportEnvironment[] = clone(SEED_REPORT_ENVIRONMENTS);
export const mockReportMetrics: ReportMetric[] = clone(SEED_REPORT_METRICS);
export const mockReportDqRules: ReportDqRule[] = clone(SEED_REPORT_DQ_RULES);
export const mockReportQueryQuotas: ReportQueryQuota[] = clone(SEED_REPORT_QUERY_QUOTAS);
export const mockReportSlaRules: ReportSlaRule[] = clone(SEED_REPORT_SLA_RULES);
export const mockReportAssetTemplates: ReportAssetTemplate[] = clone(SEED_REPORT_ASSET_TEMPLATES);
export const mockReportFillTemplates: ReportFillTemplate[] = clone(SEED_REPORT_FILL_TEMPLATES);

export const mockReportResourceAcls: ReportResourceAcl[] = [];
export const mockReportPublishApprovals: ReportPublishApproval[] = [];
export const mockReportResourceTransfers: ReportResourceTransfer[] = [];
export const mockReportPromotions: ReportEnvironmentPromotion[] = [];

export const mockReportDqRuns: ReportDqRun[] = [
  {
    id: 1,
    tenantId: null,
    ruleId: 1,
    datasetId: 2,
    status: 'succeeded',
    triggerType: 'scheduled',
    checkedRows: 6,
    failedRows: 0,
    passRate: 100,
    sampleRows: [],
    sampleRowCount: 0,
    sampleBytes: 0,
    startedAt: mockDateTimeOffset(-3_600_000),
    completedAt: mockDateTimeOffset(-3_599_200),
    durationMs: 800,
    errorMessage: null,
    schemaSignature: 'demo-department-ranking-v1',
    requestedBy: 1,
    createdAt: mockDateTimeOffset(-3_600_000),
    updatedAt: mockDateTimeOffset(-3_599_200),
  },
];

export const mockReportDqScores: ReportDqScore[] = [
  {
    id: 1,
    tenantId: null,
    datasetId: 2,
    score: 98,
    passedRules: 2,
    failedRules: 0,
    totalRules: 2,
    dimensions: { completeness: 100, validity: 98, freshness: 96 },
    measuredAt: mockDateTimeOffset(-3_599_200),
    createdAt: mockDateTimeOffset(-3_599_200),
  },
];

export const mockReportDqAnomalies: ReportDqAnomaly[] = [
  {
    id: 1,
    tenantId: null,
    datasetId: 2,
    ruleId: 2,
    runId: 1,
    severity: 'medium',
    title: '部门榜行数较昨日下降',
    detail: '演示异常，可确认、忽略或解决。',
    sample: { previousRows: 7, currentRows: 6 },
    sampleRowCount: 1,
    sampleBytes: 48,
    status: 'open',
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementNote: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: mockDateTimeOffset(-3_500_000),
    updatedAt: mockDateTimeOffset(-3_500_000),
  },
];

export const mockReportSnapshots: ReportMaterializationSnapshot[] = [
  {
    id: 1,
    tenantId: null,
    datasetId: 2,
    strategy: 'full',
    status: 'ready',
    revision: 1,
    keyField: null,
    watermark: null,
    deltaWindowMinutes: null,
    fileId: null,
    rowCount: 6,
    byteSize: 512,
    checksum: 'demo-snapshot-v1',
    startedAt: mockDateTimeOffset(-7_200_000),
    completedAt: mockDateTimeOffset(-7_199_000),
    expiresAt: null,
    errorMessage: null,
    createdBy: 1,
    createdAt: mockDateTimeOffset(-7_200_000),
    updatedAt: mockDateTimeOffset(-7_199_000),
  },
];

export const mockReportQueryCostLogs: ReportQueryCostLog[] = [
  {
    id: 1,
    tenantId: null,
    userId: 1,
    datasetId: 2,
    datasourceId: 1,
    scene: 'dashboard',
    requestId: 'demo-report-query-1',
    queuedMs: 2,
    durationMs: 38,
    rowCount: 6,
    byteSize: 512,
    costUnits: 0.01,
    cacheHit: true,
    success: true,
    errorCode: null,
    occurredAt: mockDateTimeOffset(-1_800_000),
  },
];

export const mockReportSlaViolations: ReportSlaViolation[] = [
  {
    id: 1,
    tenantId: null,
    ruleId: 1,
    datasetId: 2,
    status: 'open',
    observedValue: 92,
    targetValue: 95,
    windowStartedAt: mockDateTimeOffset(-86_400_000),
    windowEndedAt: mockDateTime(),
    detail: '演示：质量评分短暂低于目标值。',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: mockDateTimeOffset(-900_000),
    updatedAt: mockDateTimeOffset(-900_000),
  },
];

export const mockReportDeprecations: ReportDeprecationNotice[] = [];

export const mockReportChatbiSessions: ReportChatbiSession[] = [];
export const mockReportChatbiMessages: ReportChatbiMessage[] = [];

export const mockReportFillRecords: ReportFillRecord[] = [
  {
    id: 1,
    tenantId: null,
    templateId: 1,
    templateName: '月度运营数据填报',
    submitterId: 1,
    submitterName: '管理员',
    status: 'approved',
    data: { period: '2026-06', department: '运营部', activeUsers: 1280, revenue: 268000, remark: '演示记录' },
    templateRevision: 1,
    templateSchemaSnapshot: clone(SEED_REPORT_FILL_TEMPLATES[0].publishedSchema ?? SEED_REPORT_FILL_TEMPLATES[0].formSchema),
    templateNeedReview: true,
    workflowDefinitionIdSnapshot: null,
    submitComment: '月度数据确认无误',
    submittedAt: mockDateTimeOffset(-86_400_000),
    reviewedAt: mockDateTimeOffset(-82_800_000),
    reviewedBy: 1,
    reviewComment: '审核通过',
    workflowInstanceId: 1001,
    generatedDatasetId: 2,
    syncStatus: 'succeeded',
    syncTaskId: null,
    syncError: null,
    syncedAt: mockDateTimeOffset(-82_700_000),
    revision: 3,
    createdBy: 1,
    updatedBy: 1,
    createdAt: mockDateTimeOffset(-90_000_000),
    updatedAt: mockDateTimeOffset(-82_700_000),
  },
];

const ids = new Map<string, number>();

export function nextReportP2Id(key: string, source: Array<{ id: number }>): number {
  const current = ids.get(key) ?? Math.max(0, ...source.map((item) => item.id));
  const next = current + 1;
  ids.set(key, next);
  return next;
}
