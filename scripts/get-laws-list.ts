#!/usr/bin/env node
import fs from 'node:fs';
import { WafBrowser } from './waf-browser.ts';
import path from 'node:path';

const browser = new WafBrowser();
browser.installCleanup();
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36';
const ENDPOINT = 'https://flk.npc.gov.cn/law-search/search/list';
const OUTPUT = path.join(process.cwd(), 'src/laws-list.json');
const PAGE_SIZE = 2000;
const MAX_ATTEMPTS = 4; // 首次 + 3 次重试
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 1_500;

/**
 * 只要中央立法，排除地方法规（221/222/230/260/270/290/295/300/305/310）。
 * 每个 code 一个切片，失败时只重试该切片。
 */
const SLICES: { code: number; name: string }[] = [
  { code: 100, name: '宪法' },
  { code: 110, name: '宪法相关法' },
  { code: 120, name: '民法商法' },
  { code: 130, name: '行政法' },
  { code: 140, name: '经济法' },
  { code: 150, name: '社会法' },
  { code: 155, name: '生态环境法' },
  { code: 160, name: '刑法' },
  { code: 170, name: '诉讼与非诉讼程序法' },
  { code: 180, name: '法律解释' },
  { code: 190, name: '有关法律问题和重大问题的决定（部分）' },
  { code: 195, name: '修正案' },
  { code: 200, name: '修改、废止的决定（法律）' },
  { code: 210, name: '行政法规' },
  { code: 215, name: '修改、废止的决定（行政法规）' },
  { code: 220, name: '监察法规' },
  { code: 320, name: '高法司法解释' },
  { code: 330, name: '高检司法解释' },
  { code: 340, name: '联合发布司法解释' },
  { code: 350, name: '修改、废止的决定（司法解释）' },
];

interface LawRow {
  bbbs: string;
  title: string;
  flxz: string;
  flfgCodeId: number;
  zdjgName: string | null;
  gbrq: string | null;
  sxrq: string | null;
  sxx: number | null;
}

interface ApiResponse {
  code: number;
  msg?: string;
  total?: number;
  rows?: LawRow[];
}

const cookies = new Map<string, string>();

function cookieHeader(): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function absorbCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 站前 WAF 会用 307 + Set-Cookie(wzws_cid) 做挑战，必须带 cookie 重发 */
async function post(body: unknown): Promise<ApiResponse> {
  const send = (): Promise<Response> =>
    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(cookies.size ? { Cookie: cookieHeader() } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await send();
  absorbCookies(res);

  // WAF 的 307 挑战可能连续出现：带新 cookie 重发，必要时清 cookie 重新握手
  for (let round = 0; round < 4 && res.status >= 300 && res.status < 400; round++) {
    res = await send();
    absorbCookies(res);
    if (res.status >= 300 && res.status < 400) {
      cookies.clear();
      await sleep(1_000 + round * 1_000);
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    // JS 挑战：让浏览器过一次，拿到 cookie 后由外层重试
    const cookie = await browser.refresh('https://flk.npc.gov.cn/');
    cookies.clear();
    for (const pair of cookie.split('; ')) {
      const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    throw new Error('WAF 返回 HTML 拦截页');
  }

  const data = JSON.parse(text) as ApiResponse;
  if (data.code !== 200) throw new Error(`code=${data.code} msg=${data.msg ?? ''}`);
  return data;
}

async function fetchSlice(slice: { code: number; name: string }): Promise<LawRow[]> {
  const rows: LawRow[] = [];

  for (let pageNum = 1; ; pageNum++) {
    const data = await post({
      searchContent: '',
      searchType: 2,
      searchRange: 2,
      xgzlSearch: false,
      flfgCodeId: [slice.code],
      zdjgCodeId: [],
      sxx: [],
      gbrqYear: [],
      gbrq: [],
      sxrq: [],
      orderByParam: { order: 'gbrq', sort: 'DESC' },
      pageNum,
      pageSize: PAGE_SIZE,
    });

    const batch = data.rows ?? [];
    rows.push(...batch);

    if (batch.length === 0 || rows.length >= (data.total ?? 0)) return rows;
  }
}

async function fetchSliceWithRetry(slice: { code: number; name: string }): Promise<LawRow[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchSlice(slice);
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) break;
      console.warn(`  ${slice.name}(${slice.code}) 第 ${attempt} 次失败：${reason}，重试…`);
      await sleep(RETRY_DELAY_MS * attempt * 2);
    }
  }

  throw new Error(
    `${slice.name}(${slice.code}) 失败 ${MAX_ATTEMPTS} 次：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function cleanTitle(title: string): string {
  return title.replace(/<[^>]+>/g, '').trim();
}

async function main(): Promise<void> {
  const collected: LawRow[] = [];
  const failed: string[] = [];

  for (const [index, slice] of SLICES.entries()) {
    if (index > 0) await sleep(800);
    try {
      const rows = await fetchSliceWithRetry(slice);
      collected.push(...rows);
      console.log(`  ${slice.name}(${slice.code}) ${rows.length} 条`);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failed.length > 0) {
    console.error(`\n以下切片在重试 ${MAX_ATTEMPTS - 1} 次后仍失败，未写入文件：`);
    for (const message of failed) console.error(`  - ${message}`);
    process.exit(1);
  }

  const seen = new Set<string>();
  const laws = collected
    .filter((row) => (seen.has(row.bbbs) ? false : seen.add(row.bbbs)))
    .map((row) => ({
      bbbs: row.bbbs,
      title: cleanTitle(row.title),
      flxz: row.flxz,
      flfgCodeId: row.flfgCodeId,
      zdjgName: row.zdjgName,
      gbrq: row.gbrq,
      sxrq: row.sxrq,
      sxx: row.sxx,
    }))
    .sort((a, b) => (b.gbrq ?? '').localeCompare(a.gbrq ?? '') || a.bbbs.localeCompare(b.bbbs));

  const payload = {
    fetchedAt: new Date().toISOString(),
    total: laws.length,
    laws,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);

  const byCategory = new Map<string, number>();
  for (const law of laws) byCategory.set(law.flxz, (byCategory.get(law.flxz) ?? 0) + 1);

  console.log(`\n获取时间 ${payload.fetchedAt}`);
  for (const [name, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name} ${count}`);
  }
  console.log(`共 ${payload.total} 条，已写入 ${path.relative(process.cwd(), OUTPUT)}`);
  browser.close();
}

await main();
