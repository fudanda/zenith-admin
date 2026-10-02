import { useIotProductOptions, useIotDeviceOptions } from './iot-options';
import { Form } from '@douyinfe/semi-ui';

/** 表单「所属产品」下拉：新增必选；`isEdit` 时锁定（规则 / 联动 / 计划的产品不可变更） */
export function IotProductSelectField({ isEdit = false }: Readonly<{ isEdit?: boolean }>) {
  const { options } = useIotProductOptions();
  return (
    <Form.Select
      field="productId" label="所属产品" placeholder="选择产品" style={{ width: '100%' }}
      disabled={isEdit}
      extraText={isEdit ? '所属产品不可变更' : undefined}
      optionList={options}
      rules={isEdit ? [] : [{ required: true, message: '请选择所属产品' }]}
    />
  );
}

/** 表单「限定设备」下拉：按所选产品加载，可清空表示产品下全部设备 */
export function IotDeviceSelectField({ productId, placeholder = '不限（产品下全部设备）' }: Readonly<{
  productId: number | null;
  placeholder?: string;
}>) {
  const { options } = useIotDeviceOptions(productId, productId !== null);
  return (
    <Form.Select
      field="deviceId" label="限定设备" placeholder={placeholder} showClear style={{ width: '100%' }}
      optionList={options}
    />
  );
}
