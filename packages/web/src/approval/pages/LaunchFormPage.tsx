import { useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from '@tanstack/react-pacer';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, Empty, Input, Skeleton, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronLeft, Clock, GitBranch, Mail, Send, UserPlus, type LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowApproverPreviewNode } from '@arcbase/shared/workflow';
import { applyFieldPermissionsToFields, WORKFLOW_APPROVE_METHOD_LABELS as METHOD_LABEL } from '@arcbase/shared/workflow';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { SignatureClientProvider } from '@/components/signature/SignatureClientContext';
import { approvalRequest } from '../lib/approval-request';
import {
  compactSelectedInitiatorApprovers,
  firstMissingInitiatorApproverNode,
  type InitiatorApproverSelectNode,
  type SelectedInitiatorApprovers,
} from '@/components/workflow/WorkflowApprovalChainPanel';
import { UserAvatar } from '@/components/UserAvatar';
import ApproverPickerField from '../components/ApproverPicker';
import { canLaunchOnMobile } from '../lib/launch';
import { recordRecentDefinition } from '../lib/recent';
import { useApprovalChainPreview, useApprovalMe, useLaunchInstance, usePublishedDefinitions } from '../lib/queries';

const CHAIN_ICON: Record<string, LucideIcon> = {
  approve: Clock, handler: Clock, ccNode: Mail, subProcess: GitBranch,
};

/** 发起页审批链路（预测态）：竖向紧凑时间线，自选节点内联选人 */
function ChainSection({
  nodes, isLoading, isError, onRetry, selected, onSelect, highlightMissing,
}: Readonly<{
  nodes: WorkflowApproverPreviewNode[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selected: SelectedInitiatorApprovers;
  onSelect: (nodeKey: string, ids: number[]) => void;
  highlightMissing: boolean;
}>) {
  if (isLoading && nodes.length === 0) {
    return <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin /></div>;
  }
  if (isError) {
    return (
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>审批链路预测失败</Typography.Text>
        <Button size="small" onClick={onRetry}>重试</Button>
      </div>
    );
  }
  const startNode = nodes.find((n) => n.nodeType === 'start');
  const flowNodes = nodes.filter((n) => n.nodeType !== 'start');
  if (flowNodes.length === 0) {
    return <Typography.Text type="tertiary" size="small">该流程无需审批，提交后自动通过</Typography.Text>;
  }
  const items: Array<{ key: string; name: string; icon: LucideIcon; warning: boolean; body: React.ReactNode; tag?: string }> = [];
  items.push({
    key: '__start__',
    name: '发起申请',
    icon: Send,
    warning: false,
    body: (
      <div className="ap-chain__approvers">
        <span className="ap-chain__approver">
          <UserAvatar name={startNode?.approvers[0]?.name ?? '发起人'} semiSize="extra-extra-small" size={20} />
          {startNode?.approvers[0]?.name ?? '发起人'}
        </span>
      </div>
    ),
  });
  for (const n of flowNodes) {
    const isSelect = n.selectionRequired === true;
    let body: React.ReactNode;
    if (isSelect) {
      const ids = selected[n.nodeKey] ?? [];
      const missing = highlightMissing && ids.length === 0;
      body = (
        <div className="ap-chain__picker">
          <ApproverPickerField
            title={n.nodeName}
            candidates={n.selectableApprovers ?? []}
            value={ids}
            onChange={(next) => onSelect(n.nodeKey, next)}
            error={missing}
          />
          {missing && <span className="ap-chain__error">请选择该节点的审批人</span>}
        </div>
      );
    } else if (n.nodeType === 'subProcess') {
      body = <Typography.Text size="small" type="tertiary">子流程</Typography.Text>;
    } else if (n.approvers.length > 0) {
      body = (
        <div className="ap-chain__approvers">
          {n.approvers.map((a) => (
            <span key={a.id} className="ap-chain__approver">
              <UserAvatar name={a.name} semiSize="extra-extra-small" size={20} />
              {a.name}
            </span>
          ))}
        </div>
      );
    } else {
      body = (
        <Typography.Text size="small" type="warning">
          {n.empty ? '审批人将在运行时确定（自选/上级/空处理）' : '—'}
        </Typography.Text>
      );
    }
    items.push({
      key: n.nodeKey,
      name: n.branchLabel ? `${n.nodeName}（${n.branchLabel}）` : n.nodeName,
      icon: isSelect ? UserPlus : (CHAIN_ICON[n.nodeType] ?? Clock),
      warning: isSelect,
      tag: n.approveMethod ? METHOD_LABEL[n.approveMethod] : undefined,
      body,
    });
  }
  return (
    <div className="ap-chain">
      {items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <div key={item.key} className="ap-chain__node">
            <div className="ap-chain__rail">
              <span className={`ap-chain__icon${item.warning ? ' ap-chain__icon--warning' : ''}`}><Icon size={13} /></span>
              {idx < items.length - 1 && <span className="ap-chain__link" />}
            </div>
            <div className="ap-chain__content">
              <div className="ap-chain__name">
                {item.name}
                {item.tag && <Tag size="small" color="blue">{item.tag}</Tag>}
              </div>
              {item.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LaunchFormPage() {
  return <SignatureClientProvider client={approvalRequest}><LaunchFormContent /></SignatureClientProvider>;
}

function LaunchFormContent() {
  const navigate = useNavigate();
  const { definitionId } = useParams<{ definitionId: string }>();
  const defsQuery = usePublishedDefinitions();
  const meQuery = useApprovalMe();
  const launchMutation = useLaunchInstance();
  const formApi = useRef<FormApi | null>(null);

  const def = useMemo(
    () => (defsQuery.data ?? []).find((d) => d.id === Number(definitionId)) ?? null,
    [defsQuery.data, definitionId],
  );

  const defaultTitle = useMemo(() => {
    const who = meQuery.data?.nickname || meQuery.data?.username || '';
    return def ? `${def.name} - ${who} - ${dayjs().format('MM-DD HH:mm')}` : '';
  }, [def, meQuery.data]);
  const [title, setTitle] = useState<string | null>(null);

  const launchFields = useMemo(() => {
    if (!def) return [];
    const startPerms = def.flowData?.nodes.find((n) => n.data.type === 'start')?.data.fieldPermissions;
    return applyFieldPermissionsToFields(def.formFields ?? [], startPerms);
  }, [def]);

  const canSubmit = def != null && canLaunchOnMobile(def);

  // 审批链路预测：表单变更防抖 500ms 重新预测（条件分支可能随表单值变化）
  const [chainReloadKey, setChainReloadKey] = useState(0);
  const scheduleChainReload = useDebouncedCallback(() => setChainReloadKey((k) => k + 1), { wait: 500 });

  const previewQuery = useApprovalChainPreview(
    canSubmit ? def.id : null,
    chainReloadKey,
    () => (formApi.current?.getValues() ?? {}) as Record<string, unknown>,
  );
  const chainNodes = useMemo(() => previewQuery.data ?? [], [previewQuery.data]);

  // 发起人自选审批人：nodeKey -> userIds
  const [selectedApprovers, setSelectedApprovers] = useState<SelectedInitiatorApprovers>({});
  const [highlightMissing, setHighlightMissing] = useState(false);
  const selectNodes = useMemo<InitiatorApproverSelectNode[]>(
    () => chainNodes
      .filter((n) => n.selectionRequired)
      .map((n) => ({
        nodeKey: n.nodeKey,
        nodeName: n.nodeName,
        selectableApprovers: n.selectableApprovers ?? [],
        selectionRequired: n.selectionRequired ?? false,
      })),
    [chainNodes],
  );

  const handleSelect = (nodeKey: string, ids: number[]) => {
    setSelectedApprovers((prev) => ({ ...prev, [nodeKey]: ids }));
    if (ids.length > 0) setHighlightMissing(false);
  };

  const submit = async () => {
    if (!def || launchMutation.isPending) return;
    try {
      const formData = (await formApi.current?.validate() ?? {}) as Record<string, unknown>;
      const missing = firstMissingInitiatorApproverNode(selectedApprovers, selectNodes);
      if (missing) {
        setHighlightMissing(true);
        Toast.error(`请为「${missing.nodeName}」选择审批人`);
        return;
      }
      await launchMutation.mutateAsync({
        definitionId: def.id,
        title: (title ?? defaultTitle).trim() || defaultTitle,
        formData,
        priority: 'normal',
        selectedInitiatorApprovers: compactSelectedInitiatorApprovers(selectedApprovers, selectNodes),
      });
      recordRecentDefinition(def.id);
      Toast.success('提交成功');
      navigate('/', { replace: true });
    } catch { /* 校验或请求失败（request 层已 Toast） */ }
  };

  const renderBody = () => {
    if (defsQuery.isLoading) return <Skeleton placeholder={<Skeleton.Paragraph rows={5} />} loading active />;
    if (!def) return <Empty description="流程不存在或未发布" style={{ paddingTop: 60 }} />;
    if (!canLaunchOnMobile(def)) {
      return <Banner type="warning" closeIcon={null} description="该流程使用业务自定义表单，请到桌面端发起。" />;
    }
    return (
      <>
        <div className="ap-section-title">申请标题</div>
        <Input value={title ?? defaultTitle} onChange={setTitle} showClear placeholder="请输入申请标题" />
        <div className="ap-section-title">表单信息</div>
        {launchFields.length === 0
          ? <Typography.Text type="tertiary">该流程无需填写表单，直接提交即可</Typography.Text>
          : (
            <WorkflowFormRenderer
              key={`launch-${def.id}`}
              fields={launchFields}
              getFormApi={(api) => { formApi.current = api; }}
              onValueChange={scheduleChainReload}
            />
          )}
        <div className="ap-section-title">审批流程</div>
        <ChainSection
          nodes={chainNodes}
          isLoading={previewQuery.isLoading}
          isError={previewQuery.isError}
          onRetry={() => void previewQuery.refetch()}
          selected={selectedApprovers}
          onSelect={handleSelect}
          highlightMissing={highlightMissing}
        />
      </>
    );
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">{def?.name ?? '发起申请'}</span>
      </div>
      <div className={`ap-body${canSubmit ? ' ap-body--with-footer' : ''}`}>{renderBody()}</div>
      {canSubmit && (
        <div className="ap-footer-bar">
          <Button theme="solid" type="primary" loading={launchMutation.isPending} onClick={() => void submit()}>
            提交申请
          </Button>
        </div>
      )}
    </div>
  );
}
