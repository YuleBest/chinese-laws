#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/**
 * 生成仓库根目录的 TOC.md：整棵 laws/ 的中文标题索引，链接相对仓库根目录。
 *
 * 链接文案优先取 name-mapping-table.json 里的原始标题（拼音文件名对应的中文名），
 * 没有映射的用文档 H1，再退回文件名。
 */

const ROOT = process.cwd();
const START = path.join(ROOT, 'laws');
const OUTPUT = path.join(ROOT, 'TOC.md');
const collator = new Intl.Collator('zh-CN');

interface Entry {
  title: string;
  link: string;
  date: string;
}

interface DirNode {
  name: string;
  dir: string;
  dirs: DirNode[];
  files: Entry[];
}

/** 「目录/文件名」→ 原始中文标题；映射表是唯一标题源 */
function loadTitles(): Map<string, string> {
  const map = new Map<string, string>();
  const file = path.join(ROOT, 'name-mapping-table.json');
  if (!fs.existsSync(file)) throw new Error('缺少 name-mapping-table.json，先跑 build:mapping');
  const groups = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    directory: string;
    table: { original: string; new: string }[];
  }[];
  for (const group of groups) {
    for (const entry of group.table) {
      const match = entry.original.match(/^(.*)-\d{8}\.md$/);
      if (match) map.set(`${group.directory}/${entry.new}`, match[1]);
    }
  }
  return map;
}

const titles = loadTitles();

function scan(dir: string): DirNode {
  const dirs: DirNode[] = [];
  const files: Entry[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => collator.compare(a.name, b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      dirs.push(scan(full));
      continue;
    }
    if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;

    const key = `${path.relative(START, dir).split(path.sep).join('/') || '.'}/${entry.name}`;
    const title = titles.get(key);
    if (!title) throw new Error(`映射表缺少条目：${key}`);
    const date = entry.name.match(/-(\d{8})\.md$/)?.[1] ?? '';
    files.push({
      title,
      link: path.relative(ROOT, full).split(path.sep).join('/').replace(/ /g, '%20'),
      date,
    });
  }

  return { name: path.basename(dir), dir, dirs, files };
}

/** 同名文档（不同版本）用日期区分 */
function disambiguate(node: DirNode, counts: Map<string, number>): void {
  for (const file of node.files) {
    if ((counts.get(file.title) ?? 0) < 2) continue;
    if (file.date) file.title = `${file.title}（${file.date.slice(0, 4)}-${file.date.slice(4, 6)}-${file.date.slice(6)}）`;
  }
  for (const child of node.dirs) disambiguate(child, counts);
}

function countTitles(node: DirNode, counts: Map<string, number>): void {
  for (const file of node.files) counts.set(file.title, (counts.get(file.title) ?? 0) + 1);
  for (const child of node.dirs) countTitles(child, counts);
}

const escapeText = (text: string): string => text.replace(/([\\[\]])/g, '\\$1');

function render(node: DirNode, lines: string[]): void {
  if (node.files.length > 0) {
    const rel = path.relative(START, node.dir).split(path.sep).join(' / ');
    lines.push(`## ${escapeText(rel || 'laws')}（${node.files.length}）`, '');
    for (const file of node.files) lines.push(`- [${escapeText(file.title)}](${file.link})`);
    lines.push('');
  }
  for (const child of node.dirs) render(child, lines);
}

const tree = scan(START);
const counts = new Map<string, number>();
countTitles(tree, counts);
disambiguate(tree, counts);

const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
const lines: string[] = [
  '# 目录',
  '',
  `> 共 ${total} 篇。链接相对仓库根目录，可直接在 GitHub 上搜索本文件查找法规标题。`,
  '',
];
render(tree, lines);

fs.writeFileSync(OUTPUT, `${lines.join('\n').trimEnd()}\n`);
console.log(`生成 TOC.md，收录 ${total} 篇`);
