import '@arcbase/admin/styles.css';
import '@douyinfe/semi-ui/react19-adapter';
import { ArcBaseAdmin } from '@arcbase/admin';
import { Client } from '@arcbase/client';
import { createRoot } from 'react-dom/client';
import { modules, operations } from './modules.gen';
import brand from './brand.json';
const client = new Client({ operations });
createRoot(document.getElementById('root')!).render(<ArcBaseAdmin client={client} modules={modules} basePath="/dash" assetBasePath="/dash/arcbase-assets/" brand={brand} />);
