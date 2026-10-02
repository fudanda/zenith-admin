import { ListSearchToolbar, useCrudOperationColumn } from '@/components/list-page';
import { Avatar, Button, Form, Space, Tag, Toast } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { mpKfAccountContract, type CreateMpKfAccountInput, type MpKfAccount } from '@arcbase/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  useDeleteMpKfAccounts,
  useMpKfAccountList,
  useSaveMpKfAccount,
  useSyncMpKfAccounts,
} from '@/hooks/queries/mp-kf';
import { CreateButton } from '@/components/toolbar-controls';
import { abortSubmit } from '@/lib/abort-submit';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const INVITE_LABEL: Record<string, { label: string; color: 'green' | 'orange' | 'grey' }> = {
  none: { label: '未邀请', color: 'grey' },
  inviting: { label: '邀请中', color: 'orange' },
  waiting: { label: '待确认', color: 'orange' },
  bound: { label: '已绑定', color: 'green' },
};

export default function MpKfAccountsPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const page = useListPage({
    contract: mpKfAccountContract,
    useList: useMpKfAccountList,
    params: { accountId: currentId ?? 0 },
    enabled: !!currentId,
  });
  const { tableProps } = page;

  const syncMutation = useSyncMpKfAccounts();
  const saveMutation = useSaveMpKfAccount();
  const deleteMutation = useDeleteMpKfAccounts();

  const handleSync = async () => {
    if (!currentId) return;
    await syncMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success('同步完成');
  };

  const modal = useEditModal<MpKfAccount, Pick<CreateMpKfAccountInput, 'kfAccount' | 'nickname'>, Partial<CreateMpKfAccountInput>>({
    save: saveMutation,
    defaults: { kfAccount: '', nickname: '' },
    toValues: (record) => ({ kfAccount: record.kfAccount, nickname: record.nickname }),
    // 新增归属当前公众号；编辑只改昵称
    beforeSave: (values, { isEdit }) => {
      if (!currentId) abortSubmit('validation');
      return isEdit ? { nickname: values.nickname } : { accountId: currentId, kfAccount: values.kfAccount, nickname: values.nickname };
    },
  });

  const operationColumn = useCrudOperationColumn<MpKfAccount>({
    permission: 'mp:kf',
    edit: modal,
    remove: deleteMutation,
    title: (record) => `确定删除客服「${record.nickname}」吗？`,
    content: '将同时删除微信侧客服账号。',
    width: 150,
    desktopInlineKeys: ['edit', 'delete'],
    menuAriaLabel: '多客服操作',
  });

  const columns = [
    {
      title: '客服', dataIndex: 'nickname', width: 200,
      render: (_: unknown, r: MpKfAccount) => (
        <Space>
          <Avatar size="small" src={r.avatar ?? undefined} color="blue">{r.nickname.slice(0, 1)}</Avatar>
          <span>{r.nickname}</span>
        </Space>
      ),
    },
    { title: '客服账号', dataIndex: 'kfAccount', minWidth: 220, render: renderEllipsis },
    { title: '绑定微信号', dataIndex: 'inviteWx', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    {
      title: '绑定状态', dataIndex: 'inviteStatus', width: 100,
      render: (v: string) => { const m = INVITE_LABEL[v] ?? INVITE_LABEL.none; return <Tag color={m.color} type="light">{m.label}</Tag>; },
    },
    createdAtColumn,
    operationColumn,
  ];

  const syncButton = can('mp:kf:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        extraFilters={<MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />}
        create={<CreateButton permission="mp:kf:create" onClick={modal.openCreate} disabled={!currentId}>添加客服</CreateButton>}
        actions={syncButton}
        filterTitle="多客服筛选"
        actionTitle="多客服操作"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} title={modal.isEdit ? '编辑客服' : '添加客服'} width={520}>
        <Form.Input field="kfAccount" label="客服账号" disabled={modal.isEdit}
          placeholder="形如 kf2001@公众号微信号" rules={[{ required: true, message: '请输入客服账号' }]} />
        <Form.Input field="nickname" label="客服昵称" placeholder="请输入客服昵称" rules={[{ required: true, message: '请输入客服昵称' }]} />
      </EditFormModal>
    </div>
  );
}
