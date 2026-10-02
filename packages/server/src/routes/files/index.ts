import { businessFileContract, fileContract, fileStorageConfigContract } from '@arcbase/shared/platform';
import { defineRouteDomain } from '../_kit';
import businessFilesRoutes from './business-files';
import fileStorageConfigsRoutes from './file-storage-configs';
import filesRoutes from './files';

export default defineRouteDomain({
  name: 'files',
  mounts: () => [
    [fileStorageConfigContract.basePath, fileStorageConfigsRoutes],
    [fileContract.basePath, filesRoutes],
    [businessFileContract.basePath, businessFilesRoutes],
  ],
});
