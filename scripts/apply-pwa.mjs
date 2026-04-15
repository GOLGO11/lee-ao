import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(process.argv[2] || path.join(repoRoot, 'book'));
const pwaSourceDir = path.join(repoRoot, 'pwa');
const pwaOutputDir = path.join(outputDir, 'pwa');

const PWA_HEAD_START = '<!-- leeao-pwa:head:start -->';
const PWA_HEAD_END = '<!-- leeao-pwa:head:end -->';
const PWA_BODY_START = '<!-- leeao-pwa:body:start -->';
const PWA_BODY_END = '<!-- leeao-pwa:body:end -->';

await ensureDirectory(outputDir);
await copyPwaAssets();
await writeManifest();
await copyFile(path.join(pwaSourceDir, 'sw.js'), path.join(outputDir, 'sw.js'));
await injectPwaTags();
await writeSearchIndex();
await writeOfflineManifest();

async function copyPwaAssets() {
  await copyDirectory(pwaSourceDir, pwaOutputDir, (source) => path.basename(source) !== 'sw.js');
}

async function writeManifest() {
  const manifest = {
    name: '大李敖全集5.0',
    short_name: '李敖全集',
    description: '《大李敖全集5.0》离线阅读书库',
    id: '.',
    start_url: '.',
    scope: '.',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    background_color: '#0a0a0f',
    theme_color: '#c9a96e',
    orientation: 'portrait',
    lang: 'zh-CN',
    categories: ['books', 'education', 'reference'],
    icons: [
      {
        src: 'pwa/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'pwa/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'pwa/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  await writeFile(
    path.join(outputDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function injectPwaTags() {
  const htmlFiles = (await listFiles(outputDir))
    .filter((file) => file.endsWith('.html'));

  await Promise.all(htmlFiles.map(async (file) => {
    const absolutePath = path.join(outputDir, file);
    const prefix = relativePrefix(file);
    let html = await readFile(absolutePath, 'utf8');

    html = removeBlock(html, PWA_HEAD_START, PWA_HEAD_END);
    html = removeBlock(html, PWA_BODY_START, PWA_BODY_END);

    const headBlock = [
      PWA_HEAD_START,
      '<meta name="theme-color" content="#c9a96e">',
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="李敖全集">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      `<link rel="manifest" href="${prefix}manifest.webmanifest">`,
      `<link rel="icon" type="image/png" sizes="192x192" href="${prefix}pwa/icons/icon-192.png">`,
      `<link rel="apple-touch-icon" href="${prefix}pwa/icons/apple-touch-icon.png">`,
      `<link rel="stylesheet" href="${prefix}pwa/pwa.css">`,
      PWA_HEAD_END,
    ].join('\n');

    const bodyBlock = [
      PWA_BODY_START,
      `<script defer src="${prefix}pwa/pwa.js"></script>`,
      PWA_BODY_END,
    ].join('\n');

    html = html.replace('</head>', `${headBlock}\n</head>`);
    html = html.replace('</body>', `${bodyBlock}\n</body>`);

    await writeFile(absolutePath, html, 'utf8');
  }));
}

async function writeOfflineManifest() {
  const files = (await listFiles(outputDir))
    .filter((file) => file !== 'offline-files.json')
    .filter((file) => !file.split(path.sep).some((part) => part.startsWith('.')))
    .sort((a, b) => a.localeCompare(b));

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(outputDir, file)));
    hash.update('\0');
  }

  const urls = new Set();
  for (const file of files) {
    const urlPath = toUrlPath(file);
    urls.add(urlPath);

    if (file === 'index.html') {
      urls.add('.');
    } else if (file.endsWith(`${path.sep}index.html`)) {
      urls.add(`${toUrlPath(path.dirname(file))}/`);
    }
  }

  const manifest = {
    version: hash.digest('hex').slice(0, 16),
    generatedAt: new Date().toISOString(),
    files: [...urls].sort((a, b) => a.localeCompare(b)),
  };

  await writeFile(
    path.join(outputDir, 'offline-files.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

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

async function copyDirectory(sourceDir, targetDir, shouldCopy = () => true) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (!shouldCopy(source)) continue;

    if (entry.isDirectory()) {
      await copyDirectory(source, target, shouldCopy);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
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

function relativePrefix(file) {
  const dir = path.dirname(file);
  if (dir === '.') return '';
  return `${dir.split(path.sep).map(() => '..').join('/')}/`;
}

function removeBlock(content, start, end) {
  return content.replace(new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'g'), '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toUrlPath(file) {
  return file.split(path.sep).map(encodeURIComponent).join('/');
}
