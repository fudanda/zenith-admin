import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@zenith/admin-app';
import '@douyinfe/semi-ui/lib/es/_base/base.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
