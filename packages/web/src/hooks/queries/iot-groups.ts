import type { QueryOf } from '@arcbase/shared/core';
import { iotDeviceGroupContract } from '@arcbase/shared/iot';
import { createResourceQueries } from '@/lib/contract-query';
import { iotDeviceKeys } from './iot-devices';

export type IotDeviceGroupListParams = NonNullable<QueryOf<typeof iotDeviceGroupContract.list>>;

export const {
  keys: iotGroupKeys,
  useList: useIotGroupList,
  useDetail: useIotGroupDetail,
  useSave: useSaveIotGroup,
  useDelete: useDeleteIotGroups,
  useLookup: useAllIotGroups,
} = createResourceQueries(iotDeviceGroupContract, {
  // 分组成员变更影响设备列表的「所属分组」列
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: iotDeviceKeys.lists }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: iotDeviceKeys.lists }),
});
