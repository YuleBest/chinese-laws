#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/**
 * 重建 name-mapping-table.json：laws/ 下每个文档一条「原始中文标题 → 实际文件名」。
 *
 * 已有条目一律保留（它们记录了历史文件名，增量更新靠它避免重复下载），
 * 新增文件用文档 H1 补齐。这份表是 TOC 的唯一标题源，必须完整。
 */

const ROOT = process.cwd();
const START = path.join(ROOT, 'laws');
const TABLE = path.join(ROOT, 'name-mapping-table.json');
const collator = new Intl.Collator('zh-CN');

/** 已有映射：「目录/文件名」→ 原始标题（同名不同法靠目录区分） */
const titles = new Map<string, string>();
if (fs.existsSync(TABLE)) {
  const groups = JSON.parse(fs.readFileSync(TABLE, 'utf8')) as {
    directory: string;
    table: { original: string; new: string }[];
  }[];
  for (const group of groups) {
    for (const entry of group.table) {
      const match = entry.original.match(/^(.*)-\d{8}\.md$/);
      if (match) titles.set(`${group.directory}/${entry.new}`, match[1]);
    }
  }
}

const groups = new Map<string, { original: string; new: string }[]>();

function walk(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => collator.compare(a.name, b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;

    const rel = path.relative(START, dir).split(path.sep).join('/') || '.';
    const heading = fs.readFileSync(full, 'utf8').split('\n', 1)[0];
    const title =
      titles.get(`${rel}/${entry.name}`) ?? (heading.startsWith('# ') ? heading.slice(2).trim() : entry.name);
    const date = entry.name.match(/-(\d{8})\.md$/)?.[1];

    const key = rel;
    const list = groups.get(key) ?? [];
    list.push({ original: `${title}-${date ?? '00000000'}.md`, new: entry.name });
    groups.set(key, list);
  }
}

walk(START);

const output = [...groups.entries()]
  .sort((a, b) => collator.compare(a[0], b[0]))
  .map(([directory, table]) => ({ directory, table }));

fs.writeFileSync(TABLE, `${JSON.stringify(output, null, 2)}\n`);

const total = output.reduce((sum, group) => sum + group.table.length, 0);
console.log(`更新 name-mapping-table.json：${output.length} 个目录，${total} 条映射`);
