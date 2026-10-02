import '@zenith/admin/styles.css';
import '@douyinfe/semi-ui/react19-adapter';
import { ZenithAdmin } from '@zenith/admin';
import { Client } from '@zenith/client';
import { createRoot } from 'react-dom/client';
import { modules, operations } from './modules.gen';
import brand from './brand.json';
const client = new Client({ operations });
createRoot(document.getElementById('root')!).render(<ZenithAdmin client={client} modules={modules} basePath="/dash" assetBasePath="/dash/zenith-assets/" brand={brand} />);
