import { ContentPickerModal, ChannelPickerModal } from './CmsLinkPickerModals';
import { useState } from 'react';
import { Button, Dropdown, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, Link2 } from 'lucide-react';
import { buildCmsEntityLink, buildCmsChannelCodeLink, parseCmsLink } from '@zenith/shared/cms';
import { useCmsLinkTarget } from '@/hooks/queries/cms';

type PickerMode = 'content' | 'channel' | null;

/**
 * 链接字段的「内部链接」选择能力。
 *
 * 刻意做成 hook 而非独立受控组件：链接字段本身仍由 `Form.Input` 承载，
 * 校验、脏值追踪、表单重置全部交给 Semi Form，这里只补三块 UI ——
 * 输入框右侧的选择器、下方的目标回显、以及两个选择弹窗。
 *
 * 存储值遵循 `packages/shared/src/cms-link.ts` 的协议：
 * `entity:channel@news`（栏目，优先）/ `entity:content/123` / `internal:/path` / `https://…`
 */
export function useCmsLinkPicker({
  siteId, value, onPick, disabled, excludeContentId, excludeChannelId,
}: Readonly<{
  siteId: number | undefined;
  /** 当前链接值，用于回显解析结果 */
  value: string | null | undefined;
  onPick: (next: string) => void;
  disabled?: boolean;
  /** 编辑自身时排除，避免选到自己形成跳转死循环 */
  excludeContentId?: number;
  excludeChannelId?: number;
}>) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const raw = value?.trim() ?? '';
  const ref = parseCmsLink(raw);
  const targetQuery = useCmsLinkTarget(siteId, raw);

  const hintText = ((): { text: string; danger: boolean } | null => {
    if (!raw) return null;
    if (!ref) return { text: '链接格式不合法', danger: true };
    if (ref.kind === 'internal') {
      const target = targetQuery.data;
      return target ? { text: target.exists ? `站内路径：${target.label}` : target.label, danger: !target.exists }
        : { text: `站内路径：${ref.path}`, danger: false };
    }
    if (ref.kind !== 'entity') return null;
    if (targetQuery.isFetching) return { text: '解析中…', danger: false };
    const target = targetQuery.data;
    if (!target) return { text: '目标解析失败', danger: true };
    const typeLabel = target.kind === 'entity-channel' ? '栏目' : '内容';
    return target.exists
      ? { text: `站内${typeLabel}：${target.label}`, danger: false }
      : { text: `${target.label}，链接已失效`, danger: true };
  })();

  const suffix = (
    <Dropdown
      trigger="click"
      position="bottomRight"
      clickToHide
      render={(
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => setPicker('content')}>选择内容</Dropdown.Item>
          <Dropdown.Item onClick={() => setPicker('channel')}>选择栏目</Dropdown.Item>
        </Dropdown.Menu>
      )}
    >
      <Button size="small" theme="borderless" disabled={disabled || siteId === undefined} icon={<Link2 size={14} />}>
        内部链接<ChevronDown size={12} style={{ marginLeft: 2 }} />
      </Button>
    </Dropdown>
  );

  const hint = hintText ? (
    <div style={{ marginTop: -8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      {ref?.kind === 'entity' ? <Tag size="small" color="blue">内部链接</Tag> : null}
      <Typography.Text type={hintText.danger ? 'danger' : 'tertiary'} size="small">{hintText.text}</Typography.Text>
    </div>
  ) : null;

  const modals = (
    <>
      <ContentPickerModal
        siteId={siteId}
        visible={picker === 'content'}
        excludeId={excludeContentId}
        onCancel={() => setPicker(null)}
        onSelect={(content) => { onPick(buildCmsEntityLink('content', content.id)); setPicker(null); }}
      />
      <ChannelPickerModal
        siteId={siteId}
        visible={picker === 'channel'}
        excludeId={excludeChannelId}
        onCancel={() => setPicker(null)}
        onSelect={(channel) => { onPick(buildCmsChannelCodeLink(channel.code)); setPicker(null); }}
      />
    </>
  );

  return { suffix, hint, modals };
}
