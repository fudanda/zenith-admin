import { useState } from 'react';
import { Banner, Button, Form, Modal, Popconfirm, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { copyTextWithToast } from '@/utils/clipboard';
import { iotIngestContract, iotWhitelistContract } from '@arcbase/shared/iot';
import type { CreateIotWhitelistInput, IotWhitelistEntry } from '@arcbase/shared/iot';
import { IotProductSelectField } from './components/IotSelectors';
import { useIotProductOptions } from './components/iot-options';
import {
  useDeleteIotWhitelistEntry,
  useDisableIotRegistration,
  useImportIotWhitelist,
  useIotWhitelistList,
  useIotWhitelistStats,
  useResetIotRegistrationSecret,
} from '@/hooks/queries/iot-register';
import { useListPage } from '@/hooks/useListPage';

const { Text, Paragraph } = Typography;

export default function IotRegisterPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('iot:register:manage');

  const page = useListPage({
    contract: iotWhitelistContract,
    useList: useIotWhitelistList,
    table: { empty: '暂无白名单，点击「批量导入 SN」把产线 SN 加入白名单' },
  });
  const { submittedParams, tableProps } = page;

  const statsQuery = useIotWhitelistStats(submittedParams.productId);
  const stats = statsQuery.data;

  const { items: products, options: productOptions } = useIotProductOptions();

  // ── 批量导入 ──
  const [importVisible, setImportVisible] = useState(false);
  const importMutation = useImportIotWhitelist();
  const deleteMutation = useDeleteIotWhitelistEntry();

  // ── 注册密钥管理 ──
  const [secretProductId, setSecretProductId] = useState<number | null>(null);
  const resetSecretMutation = useResetIotRegistrationSecret();
  const disableMutation = useDisableIotRegistration();
  const secretProduct = products.find((p) => p.id === secretProductId) ?? null;

  const handleResetSecret = async () => {
    if (secretProductId === null) return;
    const result = await resetSecretMutation.mutateAsync({ params: { id: secretProductId } });
    Modal.info({
      title: '注册密钥（仅本次展示）',
      width: 520,
      content: (
        <div>
          <Banner type="warning" closeIcon={null} style={{ marginBottom: 12 }}
            description="密钥明文只展示这一次，请立即复制并烧录到设备产线；刷新后无法再次查看。" />
          <Paragraph copyable={{ content: result.registrationSecret }}>
            <Text code style={{ wordBreak: 'break-all' }}>{result.registrationSecret}</Text>
          </Paragraph>
        </div>
      ),
      okText: '复制并关闭',
      onOk: () => {
        void copyTextWithToast(result.registrationSecret);
      },
    });
  };

  const columns: ColumnProps<IotWhitelistEntry>[] = [
    {
      title: '设备 SN', dataIndex: 'sn', width: 200,
      render: (v: string) => <Text code style={{ whiteSpace: 'nowrap' }}>{v}</Text>,
    },
    {
      title: '所属产品', dataIndex: 'productName', width: 160,
      render: (v: string | null) => renderEllipsis(v ?? ''),
    },
    {
      title: '状态', dataIndex: 'used', width: 90,
      render: (v: boolean) => v
        ? <Tag color="green" size="small">已注册</Tag>
        : <Tag color="grey" size="small">待注册</Tag>,
    },
    {
      title: '注册设备', dataIndex: 'deviceName', width: 160,
      render: (v: string | null) => v ? renderEllipsis(v) : EMPTY_PLACEHOLDER,
    },
    dateTimeColumn<IotWhitelistEntry>('注册时间', 'usedAt'),
    {
      title: '备注', dataIndex: 'remark', minWidth: 150,
      render: (v: string | null) => v ? renderEllipsis(v) : EMPTY_PLACEHOLDER,
    },
    dateTimeColumn<IotWhitelistEntry>('导入时间', 'createdAt'),
    createOperationColumn<IotWhitelistEntry>({
      width: 100,
      actions: (record) => [
        deleteAction({
          hidden: !canManage || record.used,
          title: `确定要移除 SN「${record.sn}」吗？`,
          content: '移除后该 SN 将无法动态注册',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已移除',
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <StatGrid minItemWidth={200} style={{ marginBottom: 16 }}>
        <StatCard title="白名单总数" value={stats ? `${stats.total} 条` : EMPTY_PLACEHOLDER} />
        <StatCard title="已注册" value={stats ? `${stats.used} 条` : EMPTY_PLACEHOLDER} accent="var(--semi-color-success)" />
        <StatCard title="待注册" value={stats ? `${stats.total - stats.used} 条` : EMPTY_PLACEHOLDER} accent="var(--semi-color-primary)" />
      </StatGrid>

      {canManage && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16,
          padding: '12px 16px', borderRadius: 'var(--semi-border-radius-medium)',
          background: 'var(--semi-color-fill-0)',
        }}>
          <Text strong style={{ whiteSpace: 'nowrap' }}>产品注册密钥</Text>
          <Select
            placeholder="选择产品" style={{ width: 220 }}
            optionList={productOptions}
            value={secretProductId ?? undefined}
            onChange={(v) => setSecretProductId((v as number | undefined) ?? null)}
          />
          {secretProduct && (
            secretProduct.registrationEnabled
              ? <Tag color="green" size="small">已开启动态注册</Tag>
              : <Tag color="grey" size="small">未开启</Tag>
          )}
          <Button
            icon={<RefreshCw size={14} />}
            disabled={secretProductId === null}
            loading={resetSecretMutation.isPending}
            onClick={() => { void handleResetSecret(); }}
          >
            {secretProduct?.registrationEnabled ? '重置密钥' : '开启并生成密钥'}
          </Button>
          {secretProduct?.registrationEnabled && (
            <Popconfirm
              title="确定关闭该产品的动态注册吗？"
              content="关闭后设备无法再通过注册接口自动建档"
              onConfirm={() => {
                void disableMutation.mutateAsync({ params: { id: secretProductId as number } }).then(() => Toast.success('已关闭'));
              }}
            >
              <Button type="danger" loading={disableMutation.isPending}>关闭注册</Button>
            </Popconfirm>
          )}
          <Text type="tertiary" size="small">
            设备用 HMAC-SHA256 签名调用 {iotIngestContract.register.fullPath} 完成自动建档，SN 须在白名单内
          </Text>
        </div>
      )}

      <ListSearchToolbar
        page={page}
        filters={['keyword', 'productId', 'used']}
        overrides={{
          productId: (p) => (
            <FilterSelect<number>
              placeholder="全部产品"
              items={productOptions}
              {...p.bind('productId')}
              width={180}
            />
          ),
        }}
        create={canManage ? <CreateButton onClick={() => setImportVisible(true)}>批量导入 SN</CreateButton> : null}
        mobileActions={false}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<IotWhitelistEntry>
        columns={columns}
        {...tableProps}
      />

      <ImportModal
        visible={importVisible}
        pending={importMutation.isPending}
        onCancel={() => setImportVisible(false)}
        onSubmit={async (values) => {
          const result = await importMutation.mutateAsync({ body: values });
          Toast.success(`导入完成：新增 ${result.inserted} 条，跳过重复 ${result.skipped} 条`);
          setImportVisible(false);
        }}
      />
    </div>
  );
}

function ImportModal({ visible, pending, onCancel, onSubmit }: Readonly<{
  visible: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: CreateIotWhitelistInput) => Promise<void>;
}>) {
  const [formApi, setFormApi] = useState<{ validate: () => Promise<Record<string, unknown>> } | null>(null);

  const handleOk = async () => {
    if (!formApi) return;
    const values = await formApi.validate();
    const sns = (values.snsText as string).split('\n').map((s) => s.trim()).filter(Boolean);
    if (sns.length === 0) {
      Toast.warning('请至少填写一个 SN');
      return;
    }
    await onSubmit({
      productId: values.productId as number,
      sns,
      remark: (values.remark as string)?.trim() || null,
    });
  };

  return (
    <AppModal
      title="批量导入白名单 SN"
      visible={visible}
      onCancel={onCancel}
      onOk={() => { void handleOk(); }}
      okButtonProps={{ loading: pending }}
      width={520}
    >
      <Form key={String(visible)} labelPosition="left" labelWidth={90} getFormApi={(api) => setFormApi(api as never)}>
        <IotProductSelectField />
        <Form.TextArea
          field="snsText" label="SN 列表" rows={8}
          placeholder={'每行一个 SN，如：\nSN-A1-0001\nSN-A1-0002'}
          rules={[{ required: true, message: 'SN 列表不能为空' }]}
        />
        <Form.Input field="remark" label="备注" placeholder="如：2026-Q1 产线批次（可空）" />
      </Form>
    </AppModal>
  );
}
