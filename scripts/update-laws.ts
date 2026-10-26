#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pinyin } from 'pinyin-pro';
import { docxToMarkdown } from './docx2md.ts';
import { WafBrowser } from './waf-browser.ts';

/**
 * 增量更新：拿上游列表里"本地还没有的版本"，下载 docx 转成规范 Markdown。
 *
 * 增量判定用「文件名里的公布日期」：上游每次修订都会产生新的 gbrq，
 * 于是产生新的文件名，本地已存在同名文件即视为已同步。
 */

const API = 'https://flk.npc.gov.cn';
const LIST_FILE = 'src/laws-list.json';
const MAPPING_FILE = 'name-mapping-table.json';
const STATE_FILE = 'src/laws-state.json';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 4;

/** 分类编码 → 目录（照上游分类树） */
const DIR_BY_CODE: Record<number, string> = {
  100: 'laws/宪法',
  110: 'laws/法律/法律/宪法相关法',
  120: 'laws/法律/法律/民法商法',
  130: 'laws/法律/法律/行政法',
  140: 'laws/法律/法律/经济法',
  150: 'laws/法律/法律/社会法',
  155: 'laws/法律/法律/生态环境法',
  160: 'laws/法律/法律/刑法',
  170: 'laws/法律/法律/诉讼与非诉讼程序法',
  180: 'laws/法律/法律解释',
  190: 'laws/法律/有关法律问题和重大问题的决定（部分）',
  195: 'laws/法律/修正案',
  200: 'laws/法律/修改、废止的决定',
  210: 'laws/行政法规/行政法规',
  215: 'laws/行政法规/修改、废止的决定',
  220: 'laws/监察法规',
  320: 'laws/司法解释/高法司法解释',
  330: 'laws/司法解释/高检司法解释',
  340: 'laws/司法解释/联合发布司法解释',
  350: 'laws/司法解释/修改、废止的决定',
};

interface LawRow {
  bbbs: string;
  title: string;
  flxz: string;
  flfgCodeId: number;
  gbrq: string | null;
}

interface Candidate {
  law: LawRow;
  dir: string;
  name: string;
}

const browser = new WafBrowser();
browser.installCleanup();
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36';
const cookies = new Map<string, string>();

function cookieHeader(): string {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function refreshCookie(url: string): Promise<void> {
  const cookie = await browser.refresh(url);
  cookies.clear();
  for (const pair of cookie.split('; ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

async function apiGet(url: string): Promise<any> {
  for (let round = 0; round < 4; round++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(cookies.size ? { Cookie: cookieHeader() } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    absorbCookies(res);

    const text = await res.text();
    if (text.trimStart().startsWith('{')) {
      const data = JSON.parse(text);
      // 挑战确认页会回 {"msg":"操作成功","code":200} 但不带 data
      if (data.code === 200 && 'data' in data) return data;
    }

    // 被挑战：交给浏览器过一次，拿回 cookie 再来
    await refreshCookie(url);
  }
  throw new Error('WAF 持续拦截');
}

function loadOverrides(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(MAPPING_FILE)) return map;
  const table = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8')) as {
    table: { original: string; new: string }[];
  }[];
  for (const group of table) {
    for (const entry of group.table) {
      // original 形如 "<标题>-<YYYYMMDD>.md"
      const match = entry.original.match(/^(.*)-(\d{8})\.md$/);
      if (match) map.set(`${match[1]}|${match[2]}`, entry.new);
    }
  }
  return map;
}

const overrides = loadOverrides();

/** 全库扫描：文件名去重 + 同一部法律的既有目录（分类调整过时沿用旧目录） */
function scanExisting(): { names: Set<string>; dirBySlug: Map<string, string>; titles: Set<string> } {
  const names = new Set<string>();
  const dirBySlug = new Map<string, string>();
  const titles = new Set<string>();

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;
      names.add(entry.name);
      const match = entry.name.match(/^(.*)-(\d{8})\.md$/);
      if (match && !dirBySlug.has(match[1])) dirBySlug.set(match[1], path.dirname(full));
      // 按「标题+日期」记录已存在版本：多音字/命名差异也能识别为同一部法
      if (match) {
        const head = fs.readFileSync(full, 'utf8').split('\n', 1)[0];
        if (head.startsWith('# ')) titles.add(`${head.slice(2).replace(/\s+/g, '')}|${match[2]}`);
      }
    }
  };

  walk('laws');
  return { names, dirBySlug, titles };
}

const existingFiles = scanExisting();

/** 标题 → 拼音首字母，按《》（）、分段，段间用 - 连接 */
function slugify(title: string): string {
  const segments: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') {
      segments.push(current);
      current = '';
    }
  };

  for (const ch of title) {
    if ('《》（(、'.includes(ch)) {
      flush();
      continue;
    }
    if (/\p{Script=Han}/u.test(ch)) {
      current += `\u0000${ch}`;
      continue;
    }
    if (/[0-9A-Za-z]/.test(ch)) {
      current += ch.toLowerCase();
    }
  }
  flush();

  return segments
    .map((segment) =>
      segment.replace(/\u0000([\p{Script=Han}]+)/gu, (_, run: string) =>
        pinyin(run, { pattern: 'first', toneType: 'none', type: 'array' }).join(''),
      ),
    )
    .filter(Boolean)
    .join('-');
}

function fileName(law: LawRow): string {
  const date = law.gbrq ? law.gbrq.replace(/-/g, '') : '00000000';
  return overrides.get(`${law.title}|${date}`) ?? `${slugify(law.title)}-${date}.md`;
}

/** 历史沿革：详情接口的 lsyg 就是该法的历次版本与公布日期 */
async function fetchHistory(law: LawRow): Promise<{ bbbs: string; gbrq: string | null }[]> {
  const data = await apiGet(`${API}/law-search/search/flfgDetails?bbbs=${law.bbbs}`);
  const list = (data?.data?.lsyg ?? []) as { bbbs: string; gbrq: string | null }[];
  return list.map((item) => ({ bbbs: item.bbbs, gbrq: item.gbrq }));
}

interface LawState {
  updatedAt: string;
  laws: Record<
    string,
    { bbbs: string; gbrq: string | null; sxx?: number | null; history: { bbbs: string; gbrq: string | null }[] }
  >;
}

function loadState(): LawState {
  if (!fs.existsSync(STATE_FILE)) return { updatedAt: '', laws: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as LawState;
}

function saveState(state: LawState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadDocx(law: LawRow, target: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await apiGet(
        `${API}/law-search/download/pc?format=docx&bbbs=${law.bbbs}&fileId=`,
      );
      const url: string | undefined = data?.data?.url;
      if (!url) throw new Error('下载接口未返回 url');

      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      // zip（docx）直接落盘；OLE2 是老式 .doc，先用 libreoffice 转 docx
      if (buffer.subarray(0, 2).toString('latin1') === 'PK') {
        fs.writeFileSync(target, buffer);
        return;
      }
      const isOle = buffer.subarray(0, 4).toString('hex').toLowerCase() === 'd0cf11e0';
      if (isOle) {
        const docPath = target.replace(/\.docx$/, '.doc');
        fs.writeFileSync(docPath, buffer);
        execFileSync('soffice', ['--headless', '--convert-to', 'docx', '--outdir', path.dirname(target), docPath], {
          timeout: 180_000,
          stdio: 'ignore',
        });
        fs.rmSync(docPath, { force: true });
        if (!fs.existsSync(target)) throw new Error('.doc 转换 docx 失败');
        return;
      }
      throw new Error(`下载内容既不是 docx 也不是 doc（${buffer.length} 字节，可能是拦截页）`);
    } catch (error) {
      lastError = error;
      const isChallenge = error instanceof Error && error.message.includes('WAF');
      if (attempt < MAX_ATTEMPTS) await sleep(isChallenge ? 15_000 : 2_000 * attempt);
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : String(lastError));
}

function parseArgs(): { limit: number; dryRun: boolean; only: Set<number> | null; bbbs: Set<string> | null } {
  const argv = process.argv.slice(2);
  const limitArg = argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Number.POSITIVE_INFINITY;
  const onlyArg = argv.indexOf('--only');
  const only = onlyArg >= 0
    ? new Set(argv[onlyArg + 1].split(',').map((code) => Number(code.trim())).filter(Number.isFinite))
    : null;
  const bbbsArg = argv.indexOf('--bbbs');
  const bbbs = bbbsArg >= 0 ? new Set(argv[bbbsArg + 1].split(',').map((id) => id.trim())) : null;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY,
    dryRun: argv.includes('--dry-run'),
    only,
    bbbs,
  };
}

async function main(): Promise<void> {
  const { limit, dryRun, only, bbbs } = parseArgs();
  const laws = (JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')) as { laws: LawRow[] }).laws;

  const candidates: Candidate[] = [];
  let existing = 0;
  let unsupported = 0;

  for (const law of laws) {
    if (bbbs && !bbbs.has(law.bbbs)) continue;
    if (only && !only.has(law.flfgCodeId)) continue;
    const name = fileName(law);
    const versionKey = `${law.title.replace(/\s+/g, '')}|${(law.gbrq ?? '').replace(/-/g, '') || '00000000'}`;
    if (existingFiles.names.has(name) || existingFiles.titles.has(versionKey)) {
      existing++;
      continue;
    }

    const slug = name.replace(/-\d{8}\.md$/, '');
    const dir = existingFiles.dirBySlug.get(slug) ?? DIR_BY_CODE[law.flfgCodeId];
    if (!dir) {
      unsupported++;
      continue;
    }
    candidates.push({ law, dir, name });
  }

  candidates.sort((a, b) => (b.law.gbrq ?? '').localeCompare(a.law.gbrq ?? ''));

  console.log(`列表 ${laws.length} 条｜已存在 ${existing}｜待更新 ${candidates.length}｜暂不处理 ${unsupported}`);
  const batch = candidates.slice(0, limit);
  if (dryRun) {
    for (const item of batch) console.log(`  [dry-run] ${item.dir}/${item.name}  ← ${item.law.title}`);
    return;
  }

  const state = loadState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flk-docx-'));
  const failed: string[] = [];
  let written = 0;

  for (const [index, item] of batch.entries()) {
    const docxPath = path.join(tmp, `${item.law.bbbs}.docx`);
    try {
      await downloadDocx(item.law, docxPath);
      const markdown = docxToMarkdown(docxPath, item.law.title);
      const outPath = path.join(item.dir, item.name);
      fs.mkdirSync(item.dir, { recursive: true });
      fs.writeFileSync(outPath, markdown);
      written++;

      let historyNote = '';
      try {
        const history = await fetchHistory(item.law);
        state.laws[item.law.title] = {
          bbbs: item.law.bbbs,
          gbrq: item.law.gbrq,
          sxx: (item.law as { sxx?: number | null }).sxx ?? null,
          history,
        };
        historyNote = `  历史沿革 ${history.length} 版`;
      } catch (error) {
        historyNote = `  历史沿革获取失败：${error instanceof Error ? error.message : error}`;
      }

      console.log(`✓ [${index + 1}/${batch.length}] ${outPath}  ${(markdown.length / 1024).toFixed(0)}KB${historyNote}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`${item.law.title}：${message}`);
      console.error(`✗ [${index + 1}/${batch.length}] ${item.law.title}：${message}`);
    } finally {
      fs.rmSync(docxPath, { force: true });
      await sleep(250 + Math.random() * 150);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  browser.close();
  state.updatedAt = new Date().toISOString();
  saveState(state);
  console.log(`\n写入 ${written} 篇，失败 ${failed.length} 篇`);
  console.log(`状态已更新 ${STATE_FILE}`);
  if (failed.length > 0) process.exit(1);
}

await main();
