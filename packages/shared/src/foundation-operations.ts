import * as z from 'zod';
import { defineContract, op } from './core/contract';
import { positionContract } from './identity/contracts/positions';
import { menuContract } from './identity/contracts/menus';
import { fileStorageConfigContract } from './platform/contracts/file-storage-configs';
import { fileContract } from './platform/contracts/files';
import { loginLogContract } from './identity/contracts/login-logs';
import { departmentContract } from './identity/contracts/departments';
import { roleContract } from './identity/contracts/roles';
import { dictContract } from './platform/contracts/dicts';
import { operationLogContract } from './platform/contracts/operation-logs';
import { userContract } from './identity/contracts/users';
import { settingsContract } from './settings/contracts';
import { foundationSettingsOperation } from './settings/foundation';
import { sessionContract } from './identity/contracts/sessions';
import { userGroupContract } from './identity/contracts/user-groups';
import { contractOperations } from './core/contract';
import type { AnyOperation } from './core/contract';
import { goAuthContract } from './identity/contracts/go-auth';
import { authContract } from './identity/contracts/auth';
import { apiTokenContract } from './identity/contracts/api-tokens';
import { integrationContract } from './integrations';
import { goDashboardContract } from './analytics/contracts/go-dashboard';

import { entityRelationsContract } from './platform/contracts/entity-relations';
import { foundationTransferContract, foundationFileContract, foundationProfileContract } from './foundation-transfer';

const foundationHealthContract = defineContract('/api/v1', {
  health: op.get('/health', { public: true, response: z.object({ status: z.literal('ok') }), summary: '数据库健康检查' }),
  ready: op.get('/ready', { public: true, response: z.object({ status: z.literal('ready') }), summary: '数据库就绪检查' }),
});

// The foundation catalog grows one verified domain at a time. An operation
// enters this list only after its Go handler and shared schema agree.
const selected: [string, AnyOperation][] = [
  ['health', foundationHealthContract.health], ['ready', foundationHealthContract.ready],
  ['authCaptcha', goAuthContract.captcha], ['authLogin', goAuthContract.login],
  ['authResolveSessionConflict', goAuthContract.resolveSessionConflict], ['authMe', goAuthContract.me], ['authLogout', goAuthContract.logout],
  ['authPreferencePolicy', goAuthContract.preferencePolicy],
  ['authPreferences', authContract.preferences], ['authPreferencesUpdate', authContract.savePreferences],
  ['authProfileUpdate',authContract.updateProfile], ['authChangePassword',authContract.changePassword],
  ['authMySessions',authContract.mySessions], ['authDeleteOtherSessions',authContract.deleteOtherSessions], ['authDeleteSession',authContract.deleteSession],
  ['authMyLoginLogs',authContract.myLoginLogs], ['authMyOperationLogs',authContract.myOperationLogs],
  ['authFavoriteMenus', authContract.favoriteMenus], ['authFavoriteMenusSave', authContract.saveFavoriteMenus],
  ['dashboardStats', goDashboardContract.stats],
  ['menusUserTree', menuContract.userTree],
  ['departmentsTree', departmentContract.tree], ['departmentsFlat', departmentContract.flat],
  ['departmentsDetail', departmentContract.detail], ['departmentsCreate', departmentContract.create],
  ['departmentsUpdate', departmentContract.update], ['departmentsRemove', departmentContract.remove],
  ['departmentsMemberPreview', departmentContract.memberPreview],
  ['positionsRemoveBatch', positionContract.removeBatch],
  ['positionsMembers', positionContract.members], ['positionsMemberPreview', positionContract.memberPreview],
  ['positionsSetMembers', positionContract.setMembers],
  ['positionsAll', positionContract.all],
  ['positionsList', positionContract.list],
  ['positionsExportCsv', positionContract.exportCsv],
  ['loginLogsExportCsv', loginLogContract.exportCsv],
  ['departmentsExportCsv', departmentContract.exportCsv],
  ['rolesExportCsv', roleContract.exportCsv],
  ['dictsExportCsv', dictContract.exportCsv],
  ['usersExportCsv', userContract.exportCsv],
  ['usersRemoveBatch', userContract.removeBatch],
  ['usersBatchStatus', userContract.batchStatus],
  ['operationLogsExportCsv', operationLogContract.exportCsv],
  ['positionsDetail', positionContract.detail],
  ['positionsCreate', positionContract.create],
  ['positionsUpdate', positionContract.update],
  ['positionsRemove', positionContract.remove],
  ['menusTree', menuContract.tree],
  ['menusFlat', menuContract.flat],
  ['menusDetail', menuContract.detail],
  ['menusCreate', menuContract.create],
  ['menusUpdate', menuContract.update],
  ['menusRemove', menuContract.remove],
  ['filesRemoveBatch', fileContract.removeBatch],
  ['filesBatchDownload', fileContract.batchDownload],
];

for (const [prefix, contract] of [['users', userContract], ['roles', roleContract], ['userGroups', userGroupContract], ['sessions', sessionContract], ['loginLogs', loginLogContract], ['operationLogs', operationLogContract], ['dicts', dictContract], ['files',fileContract], ['fileConfigs',fileStorageConfigContract]] as const) {
  for (const operation of contractOperations(contract)) {
    if (operation === userContract.alertRecipients) continue;
    const id = prefix + operation.name[0].toUpperCase() + operation.name.slice(1);
    if (!selected.some(([existing]) => existing === id)) selected.push([id, operation]);
  }
}
for (const operation of contractOperations(settingsContract)) {
  if (!['list', 'public', 'me', 'getAuth', 'updateAuth', 'getIdentitySecurity', 'updateIdentitySecurity', 'getUi', 'updateUi', 'getFiles', 'updateFiles'].includes(operation.name)) continue;
  const id='settings'+operation.name[0].toUpperCase()+operation.name.slice(1);
  selected.push([id,foundationSettingsOperation(operation)]);
}
for (const operation of contractOperations(foundationTransferContract)) selected.push(['transfer'+operation.name[0].toUpperCase()+operation.name.slice(1),operation]);
selected.push(['relationsDescribe',entityRelationsContract.describe],['relationsSection',entityRelationsContract.section]);
selected.push(['authAvatarUpload',foundationProfileContract.avatar]);
selected.push(['filesPrivateContent',foundationFileContract.privateContent]);
/** Shared release operation inventory consumed by Go generation and Web capability checks. */
for (const operation of contractOperations(apiTokenContract)) selected.push(['apiTokens'+operation.name[0].toUpperCase()+operation.name.slice(1), operation]);
for (const operation of contractOperations(integrationContract)) selected.push(['integration'+operation.name[0].toUpperCase()+operation.name.slice(1), operation]);
export const foundationOperations: ReadonlyArray<readonly [string, AnyOperation]> = selected;
