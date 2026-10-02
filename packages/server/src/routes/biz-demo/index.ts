import { bizLeaveContract } from '@arcbase/shared/biz';
import { defineRouteDomain } from '../_kit';
import bizLeaveRoutes from './biz-leave';

export default defineRouteDomain({
  name: 'biz-demo',
  mounts: () => [
    [bizLeaveContract.basePath, bizLeaveRoutes],
  ],
});
