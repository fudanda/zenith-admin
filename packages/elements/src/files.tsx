import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Button from '@douyinfe/semi-ui/lib/es/button';
import Progress from '@douyinfe/semi-ui/lib/es/progress';
import { ApiError, operationURL } from '@arcbase/client';
import { fileContract, type ManagedFile } from '@arcbase/shared/platform';
import { useArcBase } from './provider';

export interface FilePickerProps {
  accept?: string; maxSize?: number; maxCount?: number; multiple?: boolean; disabled?: boolean;
  onChange(files: File[]): void; onError?: (message: string) => void; children?: ReactNode;
}
export function validateFiles(files: readonly File[], options: Pick<FilePickerProps, 'accept' | 'maxSize' | 'maxCount' | 'multiple'>): string | null {
  if ((!options.multiple && files.length > 1) || (options.maxCount !== undefined && files.length > options.maxCount)) return '文件数量超过限制';
  for (const file of files) {
    if (options.maxSize !== undefined && file.size > options.maxSize) return `${file.name}: 文件大小超过限制`;
    const types = options.accept?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
    if (types.length && !types.some(type => type.startsWith('.') ? file.name.toLowerCase().endsWith(type) : type.endsWith('/*') ? file.type.toLowerCase().startsWith(type.slice(0, -1)) : file.type.toLowerCase() === type)) return `${file.name}: 文件类型不支持`;
  }
  return null;
}
export function FilePicker(props: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return <div>
    <input ref={input} type="file" id={id} aria-label="选择文件" style={{ display: 'none' }} accept={props.accept} multiple={props.multiple} disabled={props.disabled} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
      const problem = validateFiles(files, props); setError(problem);
      if (problem) props.onError?.(problem); else if (files.length) props.onChange(files);
    }} />
    <Button disabled={props.disabled} onClick={() => input.current?.click()}>{props.children ?? '选择文件'}</Button>
    {error && <div role="alert">{error}</div>}
  </div>;
}
export interface UploadItem { id: string; file: File; status: 'uploading' | 'uploaded' | 'cancelled' | 'failed'; progress: number; result?: ManagedFile; error?: string }
export interface FileUploaderProps extends Omit<FilePickerProps, 'onChange'> {
  onUploaded?: (file: ManagedFile) => void;
  onItemsChange?: (items: readonly UploadItem[]) => void;
  /** Optional domain adapter; must enforce the same service-side access controls. */
  upload?: (file: File, options: { signal: AbortSignal; onProgress(percent: number): void }) => Promise<ManagedFile>;
}
export function FileUploader(props: FileUploaderProps) {
  const { client, locale } = useArcBase();
  const english = locale === 'en-US';
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const requests = useRef(new Map<string, AbortController>());
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const request of requests.current.values()) request.abort(); requests.current.clear(); }; }, []);
  const change = (next: UploadItem[]) => { if (!mounted.current) return; itemsRef.current = next; setItems(next); props.onItemsChange?.(next); };
  const update = (id: string, patch: Partial<UploadItem>) => change(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item));
  const upload = async (item: UploadItem) => {
    const controller = new AbortController(); requests.current.set(item.id, controller);
    update(item.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const options = { signal: controller.signal, onProgress: (progress: number) => { if (!controller.signal.aborted) update(item.id, { progress }); } };
      let result: ManagedFile;
      if (props.upload) result = await props.upload(item.file, options);
      else {
        const form = new FormData(); form.append('file', item.file);
        const response = await client.postForm<unknown>(operationURL(fileContract.uploadOne), form, options);
        if (response.code !== 0) throw new ApiError(response.code, response.message);
        result = fileContract.uploadOne.response.parse(response.data);
      }
      if (controller.signal.aborted || !mounted.current || requests.current.get(item.id) !== controller) return;
      update(item.id, { status: 'uploaded', progress: 100, result }); props.onUploaded?.(result);
    } catch (error) {
      if (requests.current.get(item.id) !== controller) return;
      update(item.id, controller.signal.aborted ? { status: 'cancelled' } : { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally { if (requests.current.get(item.id) === controller) requests.current.delete(item.id); }
  };
  return <div className="arcbase-elements-upload">
    <FilePicker {...props} maxCount={props.maxCount === undefined ? undefined : Math.max(0, props.maxCount - items.length)} onChange={files => {
      const added = files.map(file => ({ id: crypto.randomUUID(), file, status: 'uploading' as const, progress: 0 }));
      change([...itemsRef.current, ...added]); for (const item of added) void upload(item);
    }}>{props.children ?? (english ? 'Upload files' : '上传文件')}</FilePicker>
    <ul>{items.map(item => <li key={item.id}>
      <span>{item.file.name}</span><span>{item.error ?? (english ? item.status : ({ uploading: '上传中', uploaded: '已上传', failed: '失败', cancelled: '已取消' } as const)[item.status])}</span>
      {item.status === 'uploading' && <><Progress percent={item.progress} aria-label={item.file.name} style={{ width: 120 }} /><Button onClick={() => { requests.current.get(item.id)?.abort(); update(item.id, { status: 'cancelled' }); }}>{english ? 'Cancel' : '取消'}</Button></>}
      {(item.status === 'failed' || item.status === 'cancelled') && <Button onClick={() => { void upload(item); }}>{english ? 'Retry' : '重试'}</Button>}
    </li>)}</ul>
  </div>;
}
