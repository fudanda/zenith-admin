import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const webRoot = resolve(root, '../web');
process.chdir(webRoot);
process.env.ZENITH_WEB_ENTRY = 'main';
process.env.VITE_DEPLOYMENT_ID = 'go-foundation';
await build({ configFile: resolve(root, 'vite.config.ts'), mode: 'go-foundation' });
const dist = resolve(root, 'dist');
mkdirSync(resolve(dist, 'public'), { recursive: true });
for (const name of ['avatars', 'monaco']) cpSync(resolve(webRoot, 'public', name), resolve(dist, 'public', name), { recursive: true });
// The public props have one source; emitted declarations have no Web dependency.
const source = readFileSync(resolve(webRoot, 'src/admin/types.ts'), 'utf8');
const declaration = ts.transpileDeclaration(source, { compilerOptions: { declaration: true, isolatedDeclarations: true }, fileName: 'types.ts' });
if (declaration.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(declaration.diagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => webRoot, getNewLine: () => '\n' }));
writeFileSync(resolve(dist, 'types.d.ts'), declaration.outputText);
writeFileSync(resolve(dist, 'index.d.ts'), 'import type { ReactElement } from "react";\nimport type { ZenithAdminProps } from "./types.js";\nexport type { ZenithAdminProps, ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from "./types.js";\nexport declare function ZenithAdmin(props: ZenithAdminProps): ReactElement;\n');
