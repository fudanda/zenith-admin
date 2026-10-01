import '@douyinfe/semi-ui/react19-adapter';
import '@zenith/elements/styles.css';
import { createRoot } from 'react-dom/client';
import { Client } from '@zenith/client';
import { ZenithProvider, SessionBoundary, PermissionGuard, UserAvatar, LoginForm, FileUploader, useSession, type UploadItem } from '@zenith/elements';
import { useState } from 'react';

const client = new Client();
function Content() {
  const session = useSession();
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  return <SessionBoundary loading={<p>恢复会话…</p>} unauthenticated={<LoginForm />} unavailable={(error, retry) => <div role="alert">{error?.message}<button onClick={() => { void retry(); }}>重试会话</button></div>}>
    <UserAvatar name={session.session?.user.nickname ?? session.session?.user.username ?? ''} avatar={session.session?.user.avatar} />
    <p data-testid="session-user">{session.session?.user.username}</p>
    <PermissionGuard permission="system:file:upload"><FileUploader multiple maxSize={10 * 1024 * 1024} onItemsChange={setItems} /></PermissionGuard>
    <ul data-testid="uploaded-files">{items.filter(item => item.status === 'uploaded').map(item => <li key={item.id}><a href={item.result?.url}>{item.file.name}</a></li>)}</ul>
    <button onClick={() => { void session.logout(); }}>退出登录</button>
  </SessionBoundary>;
}
const root = createRoot(document.getElementById('root')!);
function mount() { root.render(<ZenithProvider client={client}><main style={{ maxWidth: 500, padding: 24, margin: 'auto' }}><Content /></main></ZenithProvider>); }
mount();
declare global { interface Window { zenithElementsExample: { mount(): void; unmount(): void } } }
window.zenithElementsExample = { mount, unmount: () => root.render(null) };
