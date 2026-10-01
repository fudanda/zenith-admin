import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vite extracts the runtime CSS. Declaration consumers need no ambient CSS module.
const path = fileURLToPath(new URL('../dist/index.d.ts', import.meta.url));
writeFileSync(path, readFileSync(path, 'utf8').replace(/^import ['"]\.\/styles\.css['"];\r?\n/m, ''));
writeFileSync(fileURLToPath(new URL('../dist/styles.d.ts', import.meta.url)), 'export {};\n');
