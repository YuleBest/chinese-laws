import fs from 'node:fs';
import path from 'node:path';

/** sxx：1 已废止 / 2 已修改 / 3 有效 / 4 尚未生效 */
export const STATUS_LABEL: Record<number, string> = {
  1: '已废止',
  2: '已修改',
  3: '有效',
  4: '尚未生效',
};

const normalize = (text: string): string => text.replace(/\s+/g, '');

/**
 * 由列表快照构建「标题+日期 → sxx」的查表函数。
 * 文档的 H1 与文件名日期能把法规版本唯一确定下来。
 */
export function loadStatusLookup(root = process.cwd()): (title: string, date: string) => number | null {
  const file = path.join(root, 'src/laws-list.json');
  if (!fs.existsSync(file)) return () => null;

  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    laws: { title: string; gbrq: string | null; sxx: number | null }[];
  };

  const map = new Map<string, number | null>();
  for (const law of snapshot.laws) {
    const date = (law.gbrq ?? '').replace(/-/g, '') || '00000000';
    map.set(`${normalize(law.title)}|${date}`, law.sxx);
  }

  return (title, date) => map.get(`${normalize(title)}|${date}`) ?? null;
}

/** 只在非「有效」且状态明确时打标，避免索引里全是噪声 */
export function statusMark(sxx: number | null): string {
  if (sxx === null || sxx === 3) return '';
  return STATUS_LABEL[sxx] ? `〔${STATUS_LABEL[sxx]}〕` : '';
}
