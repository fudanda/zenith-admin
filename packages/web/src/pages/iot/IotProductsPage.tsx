import { useState } from 'react';
import { Form, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { CreateButton } from '@/components/toolbar-controls';
import { createdAtColumn, renderEllipsis, EMPTY_PLACEHOLDER, enabledStatusColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { IOT_VALIDATION_MODE_OPTIONS, iotProductContract } from '@arcbase/shared/iot';
import type { CreateIotProductInput, IotProduct } from '@arcbase/shared/iot';
import {
  useDeleteIotProducts,
  useIotProductList,
  useSaveIotProduct,
} from '@/hooks/queries/iot-products';
import IotThingModelDrawer from './IotThingModelDrawer';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const { Text } = Typography;

/** 产品表单值：记录里的 null 描述在表单中归一为空串 */
type IotProductFormValues = Partial<CreateIotProductInput>;

export default function IotProductsPage() {
  const { hasPermission } = usePermission();
  const [modelProduct, setModelProduct] = useState<IotProduct | null>(null);

  const page = useListPage({
    contract: iotProductContract,
    useList: useIotProductList,
    table: { empty: '暂无 IoT 产品' },
  });
  const { tableProps } = page;

  const modal = useEditModal<IotProduct, IotProductFormValues, Partial<CreateIotProductInput>>({
    entityName: '产品',
    save: useSaveIotProduct(),
    toValues: (r) => ({
      name: r.name,
      validationMode: r.validationMode,
      status: r.status,
      description: r.description ?? '',
    }),
    defaults: { status: 'enabled', validationMode: 'loose' },
    beforeSave: (values) => ({
      name: values.name,
      validationMode: values.validationMode,
      status: values.status,
      description: values.description || null,
    }),
    labelWidth: 100,
  });

  const deleteMutation = useDeleteIotProducts();

  const columns: ColumnProps<IotProduct>[] = [
    {
      title: '产品名称', dataIndex: 'name', width: 180,
      render: (v: string) => renderEllipsis(v),
    },
    {
      title: '物模型', width: 210,
      render: (_: unknown, r: IotProduct) => (
        <div style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
          <Tag size="small" color="cyan">属性 {r.propertyCount ?? 0}</Tag>
          <Tag size="small" color="blue">服务 {r.serviceCount ?? 0}</Tag>
          <Tag size="small" color="orange">事件 {r.eventCount ?? 0}</Tag>
        </div>
      ),
    },
    {
      title: '遥测校验', dataIndex: 'validationMode', width: 90,
      render: (v: IotProduct['validationMode']) => (
        <Tag size="small" color={v === 'strict' ? 'red' : 'grey'}>{v === 'strict' ? '严格' : '宽松'}</Tag>
      ),
    },
    {
      title: '描述', dataIndex: 'description', minWidth: 240,
      render: (v: string | null) => v ? renderEllipsis(v) : EMPTY_PLACEHOLDER,
    },
    {
      title: '设备数', dataIndex: 'deviceCount', width: 90, align: 'right',
      render: (v: number) => <Text strong>{v}</Text>,
    },
    createdAtColumn,
    enabledStatusColumn(),
    createOperationColumn<IotProduct>({
      width: 220,
      actions: (record) => [
        {
          key: 'model', label: '物模型', onClick: () => setModelProduct(record),
        },
        ...(hasPermission('iot:product:update') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('iot:product:delete'),
          disabled: (record.deviceCount ?? 0) > 0,
          disabledReason: (record.deviceCount ?? 0) > 0 ? '产品下存在设备' : undefined,
          title: `确定要删除产品「${record.name}」吗？`,
          content: '删除后不可恢复，物模型定义一并删除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status']}
        create={<CreateButton permission="iot:product:create" onClick={modal.openCreate} />}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<IotProduct>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} width={560}>
        <Form.Input field="name" label="产品名称" placeholder="如：温湿度传感器"
          rules={[{ required: true, message: '产品名称不能为空' }]} />
        <Form.Select
          field="validationMode" label="遥测校验" style={{ width: '100%' }}
          optionList={IOT_VALIDATION_MODE_OPTIONS}
          extraText="宽松：校验已声明属性（不符丢弃该键），未声明键放行；严格：仅接受已声明属性"
        />
        <FormStatusRadioGroup />
        <Form.TextArea field="description" label="描述" rows={3} placeholder="产品用途说明（选填）" maxCount={2000} />
      </EditFormModal>

      <IotThingModelDrawer product={modelProduct} onClose={() => setModelProduct(null)} />
    </div>
  );
}
