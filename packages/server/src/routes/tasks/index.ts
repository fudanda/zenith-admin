import { cronJobContract, systemSchedulerContract } from '@arcbase/shared/platform';
import { asyncTaskContract, exportJobContract, importJobContract, taskDemoContract } from '@arcbase/shared/tasks';
import { defineRouteDomain } from '../_kit';
import asyncTasksRoutes from './async-tasks';
import cronJobsRoutes from './cron-jobs';
import exportJobsRoutes from './export-jobs';
import importJobsRoutes from './import-jobs';
import systemSchedulerRoutes from './system-scheduler';
import taskDemoRoutes from './task-demo';

export default defineRouteDomain({
  name: 'tasks',
  mounts: () => [
    [exportJobContract.basePath, exportJobsRoutes],
    [importJobContract.basePath, importJobsRoutes],
    [asyncTaskContract.basePath, asyncTasksRoutes],
    [systemSchedulerContract.basePath, systemSchedulerRoutes],
    [cronJobContract.basePath, cronJobsRoutes],
    [taskDemoContract.basePath, taskDemoRoutes],
  ],
});