import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(process.argv[2] || path.join(repoRoot, 'book'));

await ensureDirectory(outputDir);
await writeSearchIndex();
await writePwaRemovalWorker();

async function writeSearchIndex() {
  const sourceFiles = (await listFiles(repoRoot))
    .filter((file) => file.endsWith('.md'))
    .filter((file) => !file.split(path.sep).some((part) => ['.git', 'book', 'android', 'node_modules', 'pwa', 'scripts'].includes(part)))
    .filter((file) => file !== 'SUMMARY.md')
    .sort((a, b) => a.localeCompare(b));

  const docsDir = path.join(outputDir, 'search', 'docs');
  await mkdir(docsDir, { recursive: true });

  const docs = [];
  for (let i = 0; i < sourceFiles.length; i += 1) {
    const file = sourceFiles[i];
    const markdown = await readFile(path.join(repoRoot, file), 'utf8');
    const text = normalizeSearchText(markdown);
    const docFile = `doc-${String(i + 1).padStart(4, '0')}.txt`;

    await writeFile(path.join(docsDir, docFile), text, 'utf8');
    docs.push({
      title: getMarkdownTitle(markdown, file),
      url: markdownToUrl(file),
      text: `search/docs/${docFile}`,
      size: text.length,
    });
  }

  const hash = createHash('sha256');
  for (const doc of docs) {
    hash.update(doc.title);
    hash.update('\0');
    hash.update(doc.url);
    hash.update('\0');
    hash.update(String(doc.size));
    hash.update('\0');
  }

  const manifest = {
    version: hash.digest('hex').slice(0, 16),
    generatedAt: new Date().toISOString(),
    docs,
  };

  await mkdir(path.join(outputDir, 'search'), { recursive: true });
  await writeFile(
    path.join(outputDir, 'search', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function normalizeSearchText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>*+-]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function getMarkdownTitle(markdown, file) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();

  const basename = path.basename(file, '.md');
  return basename === 'README' ? path.basename(path.dirname(file)) : basename;
}

function markdownToUrl(file) {
  if (file === 'README.md') return '.';
  if (file.endsWith(`${path.sep}README.md`)) {
    return `${toUrlPath(path.dirname(file))}/`;
  }
  return toUrlPath(file.replace(/\.md$/, '.html'));
}

async function writePwaRemovalWorker() {
  await writeFile(
    path.join(outputDir, 'sw.js'),
    `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('leeao-mdbook-'))
      .map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`,
    'utf8'
  );
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, absolutePath));
    }
  }

  return files;
}

async function ensureDirectory(directory) {
  try {
    await readdir(directory);
  } catch (error) {
    throw new Error(`Output directory not found: ${directory}`);
  }
}

function toUrlPath(file) {
  return file.split(path.sep).map(encodeURIComponent).join('/');
}
