/**
 * 频道消息内容编辑（text / image / news 三型）的公共实现。
 *
 * 群发（ChannelPublishModal）与自动回复（ChannelAutoReplyDrawer）共用同一套
 * 内容字段渲染与图文预览，避免两处各自手写产生漂移。
 * 值对象与校验见 channel-content.ts。
 *
 * 字段组件必须放在 Semi <Form> 内（用 Form.Slot 对齐外层 label 布局），
 * 但值本身不进 Form——由调用方以受控 state 持有，便于模板载入 / 编辑回填。
 */
import { Form, Input, TextArea, Typography } from '@douyinfe/semi-ui';
import DOMPurify from 'dompurify';
import type { ChannelMessageType } from '@arcbase/shared/messaging';
import { AppModal } from '@/components/AppModal';
import { ImageUploadField } from '@/components/ImageUploadField';
import RichTextEditor from '@/components/RichTextEditor';
import type { ChannelContentValue } from './channel-content';

interface ChannelContentFieldsProps {
  readonly type: ChannelMessageType;
  readonly value: ChannelContentValue;
  readonly onChange: (patch: Partial<ChannelContentValue>) => void;
  /** text 类型是否展示可选标题（群发有，自动回复没有） */
  readonly showTextTitle?: boolean;
}

/**
 * 类型对应的基础内容字段（不含富文本正文——正文块用 ChannelNewsBodyField 单独放，
 * 由调用方决定整行独占还是内联）。
 */
export function ChannelContentFields({ type, value, onChange, showTextTitle }: Readonly<ChannelContentFieldsProps>) {
  if (type === 'image') {
    return (
      <Form.Slot label="图片">
        <ImageUploadField value={value.imageUrl} onChange={(url) => onChange({ imageUrl: url })} label="图片" />
      </Form.Slot>
    );
  }
  if (type === 'news') {
    return (
      <>
        <Form.Slot label={{ text: '标题', required: true }}>
          <Input value={value.title} onChange={(v) => onChange({ title: v })} placeholder="请填写图文标题" maxLength={200} />
        </Form.Slot>
        <Form.Slot label="封面图">
          <ImageUploadField
            value={value.cover}
            onChange={(url) => onChange({ cover: url })}
            label="封面"
            previewStyle={{ width: 120, height: 80 }}
          />
        </Form.Slot>
        <Form.Slot label="摘要">
          <TextArea value={value.summary} onChange={(v) => onChange({ summary: v })} placeholder="可选，卡片与列表摘要" autosize={{ minRows: 2, maxRows: 3 }} maxLength={500} />
        </Form.Slot>
        <Form.Slot label="跳转链接">
          <Input value={value.linkUrl} onChange={(v) => onChange({ linkUrl: v })} placeholder="可选，卡片「查看详情」跳转的 URL" maxLength={1000} />
        </Form.Slot>
      </>
    );
  }
  return (
    <>
      {showTextTitle && (
        <Form.Slot label="标题">
          <Input value={value.title} onChange={(v) => onChange({ title: v })} placeholder="可选" maxLength={200} />
        </Form.Slot>
      )}
      <Form.Slot label={{ text: '内容', required: true }}>
        <TextArea value={value.content} onChange={(v) => onChange({ content: v })} placeholder="请输入文本内容" autosize={{ minRows: 6, maxRows: 16 }} />
      </Form.Slot>
    </>
  );
}

interface ChannelNewsBodyFieldProps {
  readonly value: ChannelContentValue;
  readonly onChange: (patch: Partial<ChannelContentValue>) => void;
  readonly height?: number;
}

/** 图文富文本正文块；调用方决定放整行还是单栏 */
export function ChannelNewsBodyField({ value, onChange, height = 440 }: Readonly<ChannelNewsBodyFieldProps>) {
  return (
    <Form.Slot label="正文">
      <RichTextEditor
        value={value.bodyHtml}
        onChange={(html) => onChange({ bodyHtml: html })}
        placeholder="图文正文，支持富文本排版与图片混排…"
        height={height}
      />
    </Form.Slot>
  );
}

interface ChannelNewsPreviewModalProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly value: ChannelContentValue;
}

/** 图文预览弹窗：封面 + 标题 + 摘要 + 净化后的正文 */
export function ChannelNewsPreviewModal({ visible, onCancel, value }: Readonly<ChannelNewsPreviewModalProps>) {
  const title = value.title.trim();
  const summary = value.summary.trim();
  const bodyHtml = value.bodyHtml.trim();
  return (
    <AppModal title="图文预览" visible={visible} onCancel={onCancel} footer={null} width={720}>
      <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
        {value.cover && <img src={value.cover} alt="封面预览" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block', borderRadius: 'var(--semi-border-radius-medium)', marginBottom: 12 }} />}
        <Typography.Title heading={5} style={{ margin: 0 }}>{title || '图文标题'}</Typography.Title>
        {summary && (
          <Typography.Text type="tertiary" style={{ display: 'block', marginTop: 8 }}>{summary}</Typography.Text>
        )}
        {bodyHtml
          ? (
            <div
              style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--semi-color-border)', fontSize: 14, lineHeight: 1.8, wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyHtml) }}
            />
          )
          : <Typography.Text type="tertiary" style={{ display: 'block', marginTop: 14 }}>（正文为空）</Typography.Text>}
      </div>
    </AppModal>
  );
}
