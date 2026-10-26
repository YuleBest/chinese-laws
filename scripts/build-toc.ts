#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

interface FileEntry {
  name: string;
  title: string;
  display: string;
}

interface DirNode {
  name: string;
  dir: string;
  dirs: DirNode[];
  files: FileEntry[];
}

const ROOT = process.cwd();
const START = path.join(ROOT, 'laws');
const ROOT_TEMPLATE = path.join(ROOT, 'README_template.md');
const DEFAULT_TEMPLATE = path.join(ROOT, 'README_template_default.md');
const SKIP_DIRS = new Set<string>(['.git', 'node_modules', 'scripts']);
const EXCLUDED_FILES = new Set<string>(['README.md', 'README_template.md', 'README_template_default.md']);
const collator = new Intl.Collator('zh-CN');

function readTitle(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1] : path.basename(file, '.md');
}

function disambiguate(files: FileEntry[]): void {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.title, (counts.get(file.title) ?? 0) + 1);

  for (const file of files) {
    if ((counts.get(file.title) ?? 0) < 2) continue;
    const date = file.name.match(/-(\d{4})(\d{2})(\d{2})\.md$/);
    file.display = date
      ? `${file.title}（${date[1]}-${date[2]}-${date[3]}）`
      : `${file.title}（${path.basename(file.name, '.md')}）`;
  }
}

function scan(dir: string): DirNode | null {
  const dirs: DirNode[] = [];
  const files: FileEntry[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const child = scan(path.join(dir, entry.name));
      if (child) dirs.push(child);
    } else if (entry.isFile() && entry.name.endsWith('.md') && !EXCLUDED_FILES.has(entry.name)) {
      const title = readTitle(path.join(dir, entry.name));
      files.push({ name: entry.name, title, display: title });
    }
  }

  if (dir !== START && dirs.length === 0 && files.length === 0) return null;

  disambiguate(files);
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.display, b.display) || collator.compare(a.name, b.name));

  return { name: path.basename(dir), dir, dirs, files };
}

const escapeText = (text: string): string => text.replace(/([\\\[\]])/g, '\\$1');

function renderToc(node: DirNode): string[] {
  const lines: string[] = [];

  for (const child of node.dirs) {
    lines.push(`- [${escapeText(child.name)}](${child.name}/README.md)`);
  }

  for (const file of node.files) {
    lines.push(`- [${escapeText(file.display)}](${file.name})`);
  }

  return lines;
}

function build(node: DirNode): void {
  const rel = path.relative(ROOT, node.dir).split(path.sep).join('/');
  const toc = renderToc(node).join('\n');
  const localTemplate = path.join(node.dir, 'README_template.md');
  const templatePath = fs.existsSync(localTemplate) ? localTemplate : DEFAULT_TEMPLATE;
  const template = fs.readFileSync(templatePath, 'utf8');
  const nowDir = rel || '/';

  // 模板里没有 [TOC] 就说明不需要目录，不要往底部追加
  const output = template.replaceAll('[NOW_DIR]', nowDir).replaceAll('[TOC]', toc);

  fs.writeFileSync(path.join(node.dir, 'README.md'), output);
  for (const child of node.dirs) build(child);
}

const countDirs = (node: DirNode): number =>
  1 + node.dirs.reduce((sum, child) => sum + countDirs(child), 0);
const countFiles = (node: DirNode): number =>
  node.files.length + node.dirs.reduce((sum, child) => sum + countFiles(child), 0);

/** 条目数取上游列表的条数，缺失时退回本地文档数 */
function entryCount(fallback: number): number {
  const file = path.join(ROOT, 'src/laws-list.json');
  if (!fs.existsSync(file)) return fallback;
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { total?: number };
  return data.total ?? fallback;
}

/** 数据快照时间，取列表文件的抓取时间 */
function snapshotTime(): string {
  const file = path.join(ROOT, 'src/laws-list.json');
  let date = new Date();
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { fetchedAt?: string };
    if (data.fetchedAt) date = new Date(data.fetchedAt);
  }
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

const tree = scan(START);
if (!tree) throw new Error('无法扫描 laws 目录');

build(tree);

// 根目录 README 由 README_template.md 渲染，同样只在有 [TOC] 时才插目录
if (fs.existsSync(ROOT_TEMPLATE)) {
  const output = fs
    .readFileSync(ROOT_TEMPLATE, 'utf8')
    .replaceAll('[NOL]', String(entryCount(countFiles(tree))))
    .replaceAll('[UPDATE_TIME]', snapshotTime());
  fs.writeFileSync(path.join(ROOT, 'README.md'), output);
}

console.log(`生成 ${countDirs(tree)} 个 README.md，收录 ${countFiles(tree)} 个文档`);
