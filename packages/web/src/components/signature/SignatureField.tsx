import { useEffect, useState } from 'react';
import { Banner, Button, Empty, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { SignatureInput, SignaturePolicy, SignatureSnapshot } from '@arcbase/shared/core';
import SignaturePad from '@/components/SignaturePad';
import { useMySignature, useSaveMySignature } from '@/hooks/queries/personal-signature';

export interface SignatureFieldProps {
  value?: SignatureInput | SignatureSnapshot | null;
  onChange?: (value: SignatureInput | null) => void;
  policy?: SignaturePolicy;
  disabled?: boolean;
  autoSelectSaved?: boolean;
  savedOnly?: boolean;
}

/** 表单、逐条审批及批量签署共用；复用请求只携带本人签名 ID/版本。 */
export default function SignatureField({
  value, onChange, policy = 'reusable', disabled = false, autoSelectSaved = false, savedOnly = false,
}: Readonly<SignatureFieldProps>) {
  const [drawing, setDrawing] = useState(false);
  const [selectionExpired, setSelectionExpired] = useState(false);
  const personal = useMySignature(!disabled && policy === 'reusable');
  const save = useSaveMySignature();
  const saved = personal.data;
  const fromSaved = value?.source === 'saved';
  const matchesSaved = fromSaved && saved?.id === value.signatureId && saved.version === ('version' in value ? value.version : value.signatureVersion);
  const image = value && 'dataUrl' in value ? value.dataUrl : matchesSaved ? saved?.dataUrl : undefined;
  const staleSelection = fromSaved && value && !('dataUrl' in value) && personal.isSuccess && !matchesSaved;

  useEffect(() => {
    if (!disabled && autoSelectSaved && policy === 'reusable' && !value && !drawing && saved) {
      onChange?.({ source: 'saved', signatureId: saved.id, version: saved.version });
    }
  }, [autoSelectSaved, disabled, drawing, onChange, policy, saved, value]);

  useEffect(() => {
    if (!disabled && staleSelection) {
      setDrawing(true);
      setSelectionExpired(true);
      onChange?.(null);
    }
  }, [disabled, onChange, staleSelection]);

  const selectSaved = () => {
    if (!saved) return;
    setDrawing(false);
    setSelectionExpired(false);
    onChange?.({ source: 'saved', signatureId: saved.id, version: saved.version });
  };
  const startDrawing = () => { setDrawing(true); setSelectionExpired(false); onChange?.(null); };
  const savePersonal = async () => {
    if (!value || value.source !== 'drawn') return;
    await save.mutateAsync({ body: { dataUrl: value.dataUrl } });
    Toast.success('已保存为我的签名，之后可直接使用');
  };

  if (disabled) {
    return image ? <img src={image} alt="手写签名" style={{ maxWidth: '100%', maxHeight: 180, background: '#fff' }} />
      : <Typography.Text type="tertiary">未签名</Typography.Text>;
  }

  return (
    <div style={{ width: '100%' }}>
      {personal.error && (
        <Banner type="warning" closeIcon={null} description={(
          <Space spacing={8}>个人签名加载失败：{personal.error.message}<Button size="small" onClick={() => void personal.refetch()}>重试</Button></Space>
        )} />
      )}
      {policy === 'reusable' && personal.isLoading && <Spin size="small" />}
      {image && !drawing ? (
        <div style={{ padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', background: '#fff' }}>
          <img src={image} alt="本次使用的签名" style={{ display: 'block', maxWidth: '100%', maxHeight: 180 }} />
        </div>
      ) : savedOnly ? (
        <Empty description={saved ? '请选择本次使用的个人签名' : '请先在个人中心「我的签名」保存签名，再进行批量签署'} style={{ padding: 16 }} />
      ) : (
        <SignaturePad value={value?.source === 'drawn' ? value.dataUrl : ''}
          width={600} height={200}
          onChange={(dataUrl) => { setDrawing(true); setSelectionExpired(false); onChange?.(dataUrl ? { source: 'drawn', dataUrl } : null); }} />
      )}
      {(selectionExpired || (fromSaved && !image && !personal.isLoading)) && (
        <Typography.Paragraph type="warning" size="small">已保存的签名发生变更，请重新选择本次签名。</Typography.Paragraph>
      )}
      <Space spacing={8} wrap style={{ marginTop: 8 }}>
        {policy === 'reusable' && saved && <Button size="small" disabled={save.isPending} onClick={selectSaved}>使用我的签名</Button>}
        {policy === 'reusable' && <Button size="small" loading={personal.isFetching} onClick={() => void personal.refetch()}>刷新个人签名</Button>}
        {!savedOnly && image && !drawing && <Button size="small" onClick={startDrawing}>重新手写</Button>}
        {!savedOnly && value?.source === 'drawn' && value.dataUrl && (
          <Button size="small" loading={save.isPending} onClick={() => void savePersonal()}>保存为我的签名</Button>
        )}
        {image && <Tag size="small" color="blue">{fromSaved ? '个人签名' : '本次手写'}</Tag>}
      </Space>
      {policy === 'handwritten' && <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 8 }}>此处要求本次重新手写。</Typography.Paragraph>}
    </div>
  );
}
