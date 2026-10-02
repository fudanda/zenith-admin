import '@arcbase/admin/styles.css';
import { ArcBaseAdmin } from '@arcbase/admin';
import { Client } from '@arcbase/client';
import { createRoot } from 'react-dom/client';

const root = createRoot(document.getElementById('root')!);
const client = new Client();
function mount() {
  root.render(<ArcBaseAdmin client={client} basePath="/console" assetBasePath="/console/arcbase-assets/"
    brand={{ name: '宿主控制台', logo: <span data-testid="host-brand-logo">Z</span>, copyrightName: '宿主公司', icpNumber: '宿主备案示例', icpUrl: 'https://example.com' }}
    theme="dark" locale="zh-CN" navigateExternal={url => { window.arcbaseExample.lastExternal = url; }}
    errorFallback={error => <pre role="alert">{error.stack ?? error.message}</pre>} />);
}
mount();

// This example also exercises disposal/remount without logging out the server.
declare global { interface Window { arcbaseExample: { unmount: () => void; mount: () => void; lastExternal?: string } } }
window.arcbaseExample = { unmount: () => root.render(null), mount };
