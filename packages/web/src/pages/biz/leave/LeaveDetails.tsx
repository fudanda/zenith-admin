import { Descriptions, Empty, Typography } from '@douyinfe/semi-ui';
import type { BizLeave } from '@arcbase/shared/biz';
import { useDictItems } from '@/hooks/useDictItems';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

/** 本人业务详情与审批人查看共用业务内容，取数权限由各入口负责。 */
export default function LeaveDetails({ data }: Readonly<{ data: BizLeave | null | undefined }>) {
  const { getLabel } = useDictItems('leave_type');
  if (!data) return <Empty title="暂无请假资料" />;
  return (
    <>
      <Typography.Title heading={6}>请假申请</Typography.Title>
      <Descriptions row data={[
        { key: '申请人', value: data.applicantName ?? EMPTY_PLACEHOLDER },
        { key: '请假类型', value: getLabel(data.leaveType) },
        { key: '开始日期', value: data.startDate },
        { key: '结束日期', value: data.endDate },
        { key: '天数', value: `${data.days} 天` },
        { key: '事由', value: data.reason || EMPTY_PLACEHOLDER },
      ]} />
    </>
  );
}
