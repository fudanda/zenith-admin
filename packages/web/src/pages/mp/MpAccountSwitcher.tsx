import { Select } from '@douyinfe/semi-ui';
import { MessageCircle } from 'lucide-react';
import type { MpAccount } from '@arcbase/shared/mp';

interface Props {
  accounts: MpAccount[];
  value: number | null;
  onChange: (id: number) => void;
  loading?: boolean;
}

/** 公众号管理模块顶部「当前公众号」切换器 */
export function MpAccountSwitcher({ accounts, value, onChange, loading }: Props) {
  return (
    <Select
      prefix={<MessageCircle size={14} style={{ marginLeft: 8 }} />}
      loading={loading}
      value={value ?? undefined}
      onChange={(v) => onChange(v as number)}
      style={{ width: 220 }}
      optionList={accounts.map((a) => ({ label: a.name, value: a.id }))}
      placeholder="请选择公众号"
      filter
    />
  );
}

export default MpAccountSwitcher;
