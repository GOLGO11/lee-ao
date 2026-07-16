import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, '《大李敖全集6.0》合集');
const decoder = new TextDecoder('gb18030');
const utf8Decoder = new TextDecoder('utf-8');

const categories = [
  ['01.自传回忆类', 1, 8],
  ['02.精品散文类', 9, 15],
  ['03.惊世杂文类', 16, 31],
  ['04.小说剧本类', 32, 37],
  ['05.诗集语录类', 38, 43],
  ['06.沉思日记类', 44, 53],
  ['07.采访序跋类', 54, 58],
  ['08.书信函件类', 59, 70],
  ['09.历史文化类', 71, 81],
  ['10.节目演讲类', 82, 94],
  ['11.李敖电子报', 95, 99],
  ['12.人物研究类', 100, 126],
  ['13.国民党史政', 127, 132],
  ['14.台湾史政类', 133, 141],
  ['15.雷霆法律类', 142, 147],
  ['16.李敖祸台五十年庆祝十书', 148, 157],
  ['17.百家论李敖', 158, 165],
  ['18.李敖出版社', 166, 195],
].map(([name, start, end]) => ({ name, start, end }));

const sourceFiles = readdirSync(sourceDir)
  .filter((file) => /^\d+/.test(file) && file.endsWith('.txt'))
  .sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]));

const titleOverrides = new Map([
  [40, '李语录'],
  [114, '大江大海骗了你'],
]);

const bodyHeadingOverrides = new Map([
  [163, new Map([
    ['乌克兰女同志问李敖：有没有被男人或女人强暴的经历', '乌克兰女同志问李敖：有没有被男人或女人强暴的经历（5biao）'],
  ])],
]);

const extraBodyHeadingPatterns = new Map([
  [36, /^第\d+幕——审判/],
]);

const sourceTextCorrections = new Map([
  [92, [[
    '苏联并没有斥化到英国，可是苏联的确斥化了中国。',
    '苏联并没有赤化到英国，可是苏联的确赤化了中国。',
  ]]],
]);

const excludedTocItems = new Map([
  [87, new Set(['《李敖大哥大》简介'])],
]);

const tocSlugOverrides = new Map([
  [163, new Map([
    ['桀骜有话说（Jeff Ao）', '桀骜有话说jeff-ao'],
    ['再见啦李敖（Jeff Ao）', '再见啦李敖jeff-ao'],
    ['写在5.0发布前（Jeff Ao）', '写在50发布前jeff-ao'],
    ['六个自了汉（Jeff Ao）', '六个自了汉jeff-ao'],
  ])],
]);

if (sourceFiles.length !== 195) {
  throw new Error(`Expected 195 source books, found ${sourceFiles.length}`);
}

for (const category of categories) {
  const categoryDir = path.join(repoRoot, category.name);
  mkdirSync(categoryDir, { recursive: true });

  for (const file of readdirSync(categoryDir)) {
    if (file.endsWith('.md') && file !== 'README.md') {
      rmSync(path.join(categoryDir, file));
    }
  }

  const readme = path.join(categoryDir, 'README.md');
  try {
    statSync(readme);
  } catch {
    writeFileSync(readme, '', 'utf8');
  }
}

const books = sourceFiles.map((sourceFile, index) => {
  const number = index + 1;
  const sourcePath = path.join(sourceDir, sourceFile);
  const sourceText = applySourceTextCorrections(decodeSource(readFileSync(sourcePath), number)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n'), sourceTextCorrections.get(number));
  const parsed = convertBook(
    sourceText,
    titleOverrides.get(number),
    bodyHeadingOverrides.get(number),
    extraBodyHeadingPatterns.get(number),
    excludedTocItems.get(number),
    tocSlugOverrides.get(number),
  );
  const category = categories.find((entry) => number >= entry.start && number <= entry.end);
  const fileName = `${sanitizeFileName(parsed.title)}.md`;
  const targetPath = path.join(repoRoot, category.name, fileName);

  writeTextFile(targetPath, parsed.markdown);

  return {
    number,
    title: parsed.title,
    category: category.name,
    fileName,
  };
});

writeTextFile(path.join(repoRoot, 'SUMMARY.md'), buildSummary(books));
updateBookToml();

console.log(`Imported ${books.length} books into ${categories.length} categories.`);

function decodeSource(buffer, number) {
  if (number !== 165) return decoder.decode(buffer);

  // This source contains one UTF-8 section inside an otherwise GB18030 file.
  const startMarker = Buffer.from('2023年11月FB', 'utf8');
  const nextHeadingMarker = Buffer.from('\r\n\r\n2023', 'ascii');
  const utf8Start = buffer.indexOf(startMarker);
  const boundary = buffer.indexOf(nextHeadingMarker, utf8Start + startMarker.length);

  if (utf8Start === -1 || boundary === -1) return decoder.decode(buffer);

  const suffixStart = boundary + Buffer.byteLength('\r\n\r\n');
  return [
    decoder.decode(buffer.subarray(0, utf8Start)),
    utf8Decoder.decode(buffer.subarray(utf8Start, suffixStart)),
    decoder.decode(buffer.subarray(suffixStart)),
  ].join('');
}

function applySourceTextCorrections(sourceText, corrections = []) {
  return corrections.reduce((text, [from, to]) => {
    if (!text.includes(from)) {
      throw new Error(`Source correction target not found: ${from}`);
    }
    return text.replace(from, to);
  }, sourceText);
}

function convertBook(
  sourceText,
  titleOverride,
  headingOverrides = new Map(),
  extraBodyHeadingPattern = null,
  tocExclusions = new Set(),
  slugOverrides = new Map(),
) {
  const lines = sourceText.split('\n');
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) throw new Error('Empty source book');

  const title = titleOverride || extractTitle(lines[firstLineIndex].trim());
  const catalog = parseCatalog(lines, firstLineIndex + 1);
  const bodyStart = findBodyStart(lines, catalog);
  const introLines = trimBlankLines(catalog.introNotes);
  const creditLines = trimBlankLines(lines.slice(catalog.lastItemIndex + 1, bodyStart));
  const bodyLines = lines.slice(bodyStart);
  const bodyHeadings = collectBodyHeadings(bodyLines);
  const headingPlan = planHeadings(catalog.items, bodyHeadings);
  const extraBodyHeadings = extraBodyHeadingPattern
    ? bodyHeadings.filter((heading) => extraBodyHeadingPattern.test(heading))
    : [];
  const headingsToConvert = new Set([
    ...headingPlan.bodyHeadings,
    ...extraBodyHeadings,
  ]);
  const tocItems = (extraBodyHeadings.length > 0
    ? bodyHeadings.filter((heading) => headingsToConvert.has(heading))
    : (headingPlan.tocItems.length > 0 ? headingPlan.tocItems : catalog.items))
    .filter((item) => !tocExclusions.has(item));

  const output = [`# ${title}`, ''];
  if (tocItems.length > 0) {
    output.push(...buildBookToc(tocItems, slugOverrides), '');
  }
  if (introLines.length > 0) {
    output.push(...introLines.map(normalizeIndent), '');
  }
  if (creditLines.length > 0) {
    output.push(...creditLines.map(normalizeIndent), '');
  }

  for (const line of bodyLines) {
    const trimmed = line.trim();
    const overriddenHeading = headingOverrides.get(trimmed);
    if (
      trimmed &&
      (overriddenHeading || headingsToConvert.has(trimmed)) &&
      !/^[\s\u3000]/.test(line)
    ) {
      output.push(`## ${overriddenHeading || trimmed}`);
    } else {
      output.push(normalizeIndent(line));
    }
  }

  return {
    title,
    markdown: `${trimBlankLines(output).join('\n')}\n`,
  };
}

function extractTitle(line) {
  let title = line.replace(/总目录\s*$/, '').replace(/目录\s*$/, '').trim();
  const wrapped = title.match(/^《(.+)》$/);
  if (wrapped) title = wrapped[1].trim();
  return title;
}

function parseCatalog(lines, startIndex) {
  const items = [];
  const introNotes = [];
  let seenItem = false;
  let lastItemIndex = startIndex - 1;

  for (let index = startIndex; index < Math.min(lines.length, 1200); index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const hasIndent = /^[\s\u3000]/.test(raw);
    if (!hasIndent && seenItem) break;
    if (!hasIndent && !seenItem) continue;

    const numbered = trimmed.match(/^\d{3}[.．、]\s*(.+)$/);
    if (numbered && isTopLevelCatalogLine(raw)) {
      seenItem = true;
      items.push(numbered[1].trim());
      lastItemIndex = index;
      continue;
    }

    if (isUnnumberedCatalogItem(trimmed) && isTopLevelCatalogLine(raw)) {
      seenItem = true;
      items.push(trimmed);
      lastItemIndex = index;
      continue;
    }

    if (!seenItem) {
      introNotes.push(raw);
    }
  }

  return { items, introNotes, lastItemIndex };
}

function isTopLevelCatalogLine(line) {
  const prefix = line.match(/^[\s\u3000]*/)[0];
  const fullWidthSpaces = [...prefix].filter((char) => char === '\u3000').length;
  const asciiSpaces = [...prefix].filter((char) => char === ' ').length;
  return fullWidthSpaces <= 2 && asciiSpaces <= 4;
}

function isUnnumberedCatalogItem(trimmed) {
  if (/目录$/.test(trimmed)) return false;
  if (/注[:：]/.test(trimmed)) return false;
  return /^《.+》/.test(trimmed) || /^第[一二三四五六七八九十百0-9]+[章节幕编部篇]/.test(trimmed);
}

function findBodyStart(lines, catalog) {
  const normalizedItems = new Set(catalog.items.map(normalizeForCompare));
  for (let index = catalog.lastItemIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || /^[\s\u3000]/.test(raw)) continue;
    if (normalizedItems.has(normalizeForCompare(trimmed))) return index;
  }

  for (let index = catalog.lastItemIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() && !/^[\s\u3000]/.test(raw)) return index;
  }

  return Math.min(catalog.lastItemIndex + 1, lines.length);
}

function collectBodyHeadings(bodyLines) {
  const headings = [];
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (!trimmed || /^[\s\u3000]/.test(line)) continue;
    if (trimmed.length > 120) continue;
    headings.push(trimmed);
  }
  return headings;
}

function planHeadings(catalogItems, bodyHeadings) {
  if (catalogItems.length === 0) {
    return { tocItems: bodyHeadings, bodyHeadings };
  }

  const matches = [];
  let catalogIndex = 0;

  for (const heading of bodyHeadings) {
    const matchIndex = findMatchingCatalogIndex(heading, catalogItems, catalogIndex);
    if (matchIndex !== -1) {
      matches.push({ catalogIndex: matchIndex, heading });
      catalogIndex = matchIndex + 1;
    }
  }

  if (matches.length === 0) {
    return { tocItems: catalogItems, bodyHeadings: [] };
  }

  if (catalogItems.length > matches.length * 3) {
    const compact = matches.map((match) => match.heading);
    return { tocItems: compact, bodyHeadings: compact };
  }

  const byCatalogIndex = new Map(matches.map((match) => [match.catalogIndex, match.heading]));
  const tocItems = catalogItems.map((item, index) => byCatalogIndex.get(index) || item);
  return {
    tocItems,
    bodyHeadings: matches.map((match) => match.heading),
  };
}

function findMatchingCatalogIndex(heading, catalogItems, startIndex) {
  const normalizedHeading = normalizeForCompare(heading);
  for (let index = startIndex; index < catalogItems.length; index += 1) {
    if (isSimilar(normalizedHeading, normalizeForCompare(catalogItems[index]))) {
      return index;
    }
  }
  return -1;
}

function isSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (digitSignature(a) !== digitSignature(b)) return false;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) > 0.72) {
    return true;
  }
  const maxLength = Math.max(a.length, b.length);
  if (maxLength > 80) return false;
  return levenshtein(a, b) <= Math.max(2, Math.floor(maxLength * 0.12));
}

function digitSignature(value) {
  return (value.match(/\d+/g) || []).join('|');
}

function normalizeForCompare(value) {
  return value
    .trim()
    .replace(/^\d{1,3}[.．、]\s*/, '')
    .replace(/[㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩]/g, (char) => '一二三四五六七八九十'['㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩'.indexOf(char)])
    .replace(/[帐]/g, '账')
    .replace(/[殭]/g, '僵')
    .replace(/[対]/g, '对')
    .toLowerCase()
    .replace(/[《》〈〉“”‘’"'`.,，、:：;；!！?？()[\]（）【】{}<>＜＞·・—–_\s]/g, '');
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function buildBookToc(items, slugOverrides = new Map()) {
  const seen = new Map();
  return [
    '- [目录](#目录)',
    ...items.map((item) => {
      const slug = uniqueSlug(item, seen, slugOverrides.get(item));
      return `  * [${item}](#${slug})`;
    }),
  ];
}

function uniqueSlug(heading, seen, slugOverride) {
  const base = slugOverride || slugify(heading) || 'section';
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[《》〈〉“”‘’"'`.,，、:：;；!！?？()[\]（）【】{}<>＜＞·・]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^-\p{Letter}\p{Number}_]/gu, '');
}

function normalizeIndent(line) {
  line = line.replace(/[ \t]+$/, '');
  const match = line.match(/^ +/);
  if (!match) return line;
  const count = match[0].length;
  if (count < 4) return line;
  const fullWidth = '\u3000'.repeat(Math.floor(count / 4) * 2);
  const remainder = ' '.repeat(count % 4);
  return `${fullWidth}${remainder}${line.slice(count)}`;
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function sanitizeFileName(title) {
  return title.replace(/[<>:"/\\|?*]/g, (char) => ({
    '<': '〈',
    '>': '〉',
    ':': '：',
    '"': '＂',
    '/': '／',
    '\\': '＼',
    '|': '｜',
    '?': '？',
    '*': '＊',
  })[char]);
}

function buildSummary(books) {
  const byCategory = new Map(categories.map((category) => [category.name, []]));
  for (const book of books) byCategory.get(book.category).push(book);

  const output = ['# Summary', '', '[项目简介](README.md)', ''];
  for (const category of categories) {
    output.push(`- [${stripCategoryNumber(category.name)}](${category.name}/README.md)`);
    for (const book of byCategory.get(category.name)) {
      output.push(`  - [${book.title}](${book.category}/${book.fileName})`);
    }
  }
  output.push('');
  return output.join('\n');
}

function stripCategoryNumber(categoryName) {
  return categoryName.replace(/^\d+\./, '');
}

function updateBookToml() {
  const bookToml = path.join(repoRoot, 'book.toml');
  const content = readFileSync(bookToml, 'utf8')
    .replace(/^authors = .+$/m, 'authors = ["李敖", "wjm_tcy"]')
    .replace(/^title = .+$/m, 'title = "大李敖全集6.0"');
  writeTextFile(bookToml, content);
}

function writeTextFile(file, content) {
  writeFileSync(file, content.replace(/\r?\n/g, '\r\n'), 'utf8');
}
