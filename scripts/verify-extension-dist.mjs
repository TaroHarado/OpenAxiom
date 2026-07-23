import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (relativePath.split(path.sep).some((segment) => segment.startsWith('_'))) {
      failures.push(`Chrome-reserved path: ${relativePath}`);
    }
    if (entry.isDirectory()) await walk(fullPath);
  }
}

async function readJavaScriptFiles(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) contents.push(...await readJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) contents.push(await readFile(fullPath, 'utf8'));
  }
  return contents;
}

async function verifyManifestFiles() {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const required = [
    manifest.background?.service_worker,
    manifest.options_page,
    manifest.action?.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js ?? []),
  ].filter(Boolean);

  for (const file of new Set(required)) {
    try {
      await access(path.join(root, file));
    } catch {
      failures.push(`Manifest target missing: ${file}`);
    }
  }
}

await walk(root);
await verifyManifestFiles();

const background = await readFile(path.join(root, 'background.js'), 'utf8');
if (background.includes('import(')) {
  failures.push('Service worker contains dynamic import(), which Chrome MV3 disallows');
}

const bundleText = (await readJavaScriptFiles(root)).join('\n');
const forbiddenRuntimeIdentifiers = [
  'TRENCH_HOT_WALLET',
  'TRENCH_PREPARE_TRADE',
  'TRENCH_SEND_SIGNED_TRANSACTION',
  'TRENCH_SIGN_AND_SEND_LOCAL',
  'solscan.io',
  'axiom.trade',
  'Jupiter',
  'Jito',
];
for (const identifier of forbiddenRuntimeIdentifiers) {
  if (bundleText.includes(identifier)) failures.push(`Deprecated runtime identifier found: ${identifier}`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Extension dist is Chrome-compatible.');
