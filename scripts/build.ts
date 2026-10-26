#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

/**
 * 完整流水线：
 *   1. 拉上游列表（含时效、版本） → src/laws-list.json
 *   2. 增量下载 docx 并转 Markdown → laws/**
 *   3. 重新生成各目录 README 目录
 */

const steps: { name: string; script: string }[] = [
  { name: '获取列表', script: 'scripts/get-laws-list.ts' },
  { name: '增量更新', script: 'scripts/update-laws.ts' },
  { name: '重建映射', script: 'scripts/build-mapping.ts' },
  { name: '生成目录', script: 'scripts/build-toc.ts' },
  { name: '生成索引', script: 'scripts/build-index.ts' },
];

for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  execFileSync('node', [step.script], { stdio: 'inherit' });
}
