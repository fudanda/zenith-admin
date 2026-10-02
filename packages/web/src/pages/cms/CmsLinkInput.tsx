import { useCmsLinkPicker } from './cms-link-picker';
import { Input, withField } from '@douyinfe/semi-ui';

/** 供页面搭建等受控字段复用与内容/栏目相同的站内链接入口。 */
export const FormCmsLinkField = withField(function CmsLinkField({ siteId, value, onChange, disabled }: {
  siteId?: number; value?: string | null; onChange?: (value: string) => void; disabled?: boolean;
}) {
  const picker = useCmsLinkPicker({ siteId, value, disabled, onPick: (next) => onChange?.(next) });
  return <><Input value={value ?? ''} onChange={(next) => onChange?.(next)} disabled={disabled} showClear
    placeholder="选择站内内容/栏目，或粘贴路径、完整网址" suffix={picker.suffix} />{picker.hint}{picker.modals}</>;
});
