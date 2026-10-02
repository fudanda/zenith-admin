import {
  analyticsCampaignContract,
  analyticsContract,
  analyticsExperimentContract,
  analyticsSiteContract,
  dashboardContract,
  frontendErrorContract,
  sessionReplayContract,
} from '@arcbase/shared/analytics';
import { defineRouteDomain } from '../_kit';
import analyticsCampaignsRoutes from './analytics-campaigns';
import analyticsExperimentsRoutes from './analytics-experiments';
import analyticsRoutes from './analytics';
import analyticsSitesRoutes from './analytics-sites';
import dashboardRoutes from './dashboard';
import frontendErrorsRoutes from './frontend-errors';
import sessionReplaysRoutes from './session-replays';

export default defineRouteDomain({
  name: 'analytics',
  mounts: () => [
    [analyticsContract.basePath, analyticsRoutes, { feature: 'analytics' }],
    [analyticsSiteContract.basePath, analyticsSitesRoutes, { feature: 'analytics' }],
    [analyticsCampaignContract.basePath, analyticsCampaignsRoutes, { feature: 'analytics' }],
    [analyticsExperimentContract.basePath, analyticsExperimentsRoutes, { feature: 'analytics' }],
    [frontendErrorContract.basePath, frontendErrorsRoutes],
    [sessionReplayContract.basePath, sessionReplaysRoutes],
    [dashboardContract.basePath, dashboardRoutes],
  ],
});
