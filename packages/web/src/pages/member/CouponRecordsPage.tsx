import { useState } from 'react';
import { Button, Descriptions, Input, Toast, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ScanLine } from 'lucide-react';
import { couponContract, type MemberCoupon, type MemberCouponStatus } from '@arcbase/shared/member';
import { MEMBER_COUPON_STATUS_LABELS } from '@arcbase/shared/member';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { useCouponByCode, useCouponRecordList, useRedeemCoupon, useRevokeCouponRecord } from '@/hooks/queries/member-admin';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { KeywordInput, NumberFilter, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { memberCellColumn } from './member-admin-display';
import { useListPage } from '@/hooks/useListPage';

const statusOptions = (Object.keys(MEMBER_COUPON_STATUS_LABELS) as MemberCouponStatus[]).map((v) => ({ value: v, label: MEMBER_COUPON_STATUS_LABELS[v] }));
const STATUS_COLORS: Record<string, string> = { unused: 'blue', used: 'green', expired: 'grey', frozen: 'orange' };

export default function CouponRecordsPage() {
  const { hasPermission } = usePermission();
  const page = useListPage({
    op: couponContract.records,
    useList: useCouponRecordList,
    table: { empty: '暂无领券记录' },
  });
  const { applySearch, tableProps, filterQuery } = page;
  // 会员详情/优惠券列表入口的深链筛选（?memberKeyword= / ?couponId=，消费后即从 URL 移除）
  useListDeepLink(['memberKeyword', 'couponId'], (p) => applySearch({
    memberKeyword: p.memberKeyword,
    couponId: Number(p.couponId) || undefined,
  }));
  const revokeMutation = useRevokeCouponRecord();
  // 核销
  const [redeemVisible, setRedeemVisible] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemRemark, setRedeemRemark] = useState('');
  const [previewCode, setPreviewCode] = useState('');
  const previewQuery = useCouponByCode(previewCode, redeemVisible);
  const redeemMutation = useRedeemCoupon();
  const preview = previewQuery.data ?? null;

  const handleRevoke = async (id: number) => {
    await revokeMutation.mutateAsync({ params: { id } });
    Toast.success('已作废');
  };

  const confirmRevoke = (record: MemberCoupon) => {
    confirmDanger({
      title: '确定要作废该券码吗？',
      onOk: () => handleRevoke(record.id),
    });
  };

  const canRevoke = hasPermission('member:coupon:revoke');

  const openRedeem = () => {
    setRedeemCode('');
    setRedeemRemark('');
    setPreviewCode('');
    setRedeemVisible(true);
  };
  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      Toast.warning('请输入券码');
      return;
    }
    await redeemMutation.mutateAsync({ body: { code: redeemCode.trim(), remark: redeemRemark || undefined } });
    Toast.success('核销成功');
    setRedeemVisible(false);
  };

  const columns: ColumnProps<MemberCoupon>[] = [
    copyableNoColumn('券码', 'code', { width: 200, fixed: 'left' }),
    memberCellColumn<MemberCoupon>({ width: 140, nameField: 'memberName', idField: 'memberId' }),
    { title: '优惠券', dataIndex: 'coupon', minWidth: 160, render: (_: unknown, r: MemberCoupon) => renderEllipsis(r.coupon?.name ?? `#${r.couponId}`) },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: MemberCouponStatus) => <Tag color={STATUS_COLORS[v] as 'blue'}>{MEMBER_COUPON_STATUS_LABELS[v]}</Tag> },
    dateTimeColumn('领取时间', 'receivedAt'),
    dateTimeColumn('使用时间', 'usedAt'),
    dateTimeColumn('过期时间', 'expireAt'),
    ...(canRevoke ? [
      createOperationColumn<MemberCoupon>({
        width: 100,
        desktopInlineKeys: ['revoke'],
        actions: (record) => [
          {
            key: 'revoke',
            label: '作废',
            danger: true,
            hidden: record.status !== 'unused',
            onClick: () => confirmRevoke(record),
          },
        ],
      }),
    ] : []),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['memberKeyword', 'couponId', 'status']}
        overrides={{
          memberKeyword: (p) => <KeywordInput placeholder="会员ID/昵称" {...p.bindKeyword('memberKeyword')} width={180} />,
          couponId: (p) => (
            <NumberFilter
              placeholder="优惠券ID"
              min={1}
              {...p.bind('couponId')}
            />
          ),
          status: (p) => (
            <StatusSelect
              items={statusOptions}
              {...p.bind('status')}
            />
          ),
        }}
        create={(
          hasPermission('member:coupon:update') ? (
            <Button type="primary" icon={<ScanLine size={14} />} onClick={openRedeem}>核销券码</Button>
          ) : null
        )}
        actions={<ExportButton entity="member.coupon-records" query={filterQuery} permission="member:coupon:list" />}
        filterTitle="领券记录筛选"
      />

      <ConfigurableTable<MemberCoupon> columns={columns} {...tableProps} />

      {/* 核销券码 Modal */}
      <AppModal title="核销券码" visible={redeemVisible} width={520}
        okText="确认核销"
        okButtonProps={{ loading: redeemMutation.isPending, disabled: !preview || preview.status !== 'unused' }}
        onCancel={() => setRedeemVisible(false)} onOk={handleRedeem}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            prefix={<ScanLine size={14} />}
            placeholder="输入或扫码券码（CP 开头）"
            value={redeemCode}
            onChange={(v) => setRedeemCode(v.toUpperCase())}
            onEnterPress={() => setPreviewCode(redeemCode.trim())}
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
          <Button onClick={() => setPreviewCode(redeemCode.trim())} loading={previewQuery.isFetching}>查询</Button>
        </div>
        {previewQuery.isError && previewCode && (
          <div style={{ color: 'var(--semi-color-danger)', fontSize: 13, marginBottom: 12 }}>券码不存在，请检查输入</div>
        )}
        {preview && (
          <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', padding: '12px 16px', marginBottom: 12 }}>
            <Descriptions size="small" row data={[
              { key: '优惠券', value: preview.coupon?.name ?? `#${preview.couponId}` },
              { key: '持有会员', value: preview.memberName ?? `#${preview.memberId}` },
              {
                key: '状态',
                value: (
                  <Tag size="small" color={(STATUS_COLORS[preview.status] ?? 'blue') as 'blue'}>
                    {MEMBER_COUPON_STATUS_LABELS[preview.status]}
                  </Tag>
                ),
              },
              { key: '有效期至', value: preview.expireAt ?? '长期有效' },
            ]} />
            {preview.status !== 'unused' && (
              <div style={{ color: 'var(--semi-color-danger)', fontSize: 13, marginTop: 8 }}>该券当前不可核销</div>
            )}
          </div>
        )}
        <Input placeholder="核销备注（选填，如订单号）" value={redeemRemark} onChange={setRedeemRemark} maxLength={128} />
      </AppModal>
    </div>
  );
}
