#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STATUS_LABEL, loadStatusLookup } from './status.ts';

/**
 * 把「时效性」写进每篇文档的题注之后：
 *
 *   > 1996年10月29日…通过
 *
 *   > 时效性：已废止
 *
 * 幂等：已存在的时效性行先删掉再按当前状态写回。
 */

const ROOT = process.cwd();
const START = path.join(ROOT, 'laws');
const MARK = /^>\s*时效性：/;

const lookup = loadStatusLookup(ROOT);

let updated = 0;
let skipped = 0;

function apply(file: string): void {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (!lines[0]?.startsWith('# ')) return;

  const title = lines[0].slice(2).trim();
  const date = path.basename(file).match(/-(\d{8})\.md$/)?.[1] ?? '';
  const sxx = lookup(title, date);
  if (sxx === null || !STATUS_LABEL[sxx]) {
    skipped++;
    return;
  }

  // 先摘掉旧的时效性行，连它前面的空行一起，避免每次运行堆积空行
  const body = [...lines];
  const existing = body.findIndex((line) => MARK.test(line));
  if (existing >= 0) {
    body.splice(existing, 1);
    if (existing > 0 && body[existing - 1]?.trim() === '') body.splice(existing - 1, 1);
  }

  // 题注块（连续的 '>' 行）之后插入；没有题注就紧跟标题
  let index = 1;
  while (index < body.length && body[index].trim() === '') index++;
  if (body[index]?.startsWith('>')) {
    while (index < body.length && body[index].startsWith('>')) index++;
  } else {
    index = 1;
  }

  body.splice(index, 0, '', `> 时效性：${STATUS_LABEL[sxx]}`);
  const output = body.join('\n').replace(/\n{3,}/g, '\n\n');
  if (output !== lines.join('\n')) {
    fs.writeFileSync(file, output);
    updated++;
  }
}

function walk(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.name.endsWith('.md') && entry.name !== 'README.md') apply(full);
  }
}

walk(START);
console.log(`时效性写入 ${updated} 篇，无状态跳过 ${skipped} 篇`);
