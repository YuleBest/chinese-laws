#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

/**
 * 用无头 Chromium 过一次 WZWS 的 JS 挑战，拿到 wzws_cid 之类的 cookie。
 *
 * 挑战页是 HTTP 200 + 一大段混淆 JS，纯 HTTP 客户端过不去；
 * 浏览器解析执行后会写 cookie，再请求就能拿到真正的 JSON。
 */

const PORT = 9300 + (process.pid % 300);
const PROFILE_DIR = `/tmp/flk-chromium-${process.pid}`;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean) as string[];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return true;
    } catch {
      /* 继续等 */
    }
    await sleep(150);
  }
  return false;
}

export class WafBrowser {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, (value: unknown) => void>();
  private lastCookie = '';

  get cookie(): string {
    return this.lastCookie;
  }

  private async launch(): Promise<void> {
    if (this.proc) return;
    const binary = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!binary) throw new Error('找不到 chromium 可执行文件');

    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    this.proc = spawn(
      binary,
      [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--no-sandbox',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    this.proc.unref();

    const ready = await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, 20_000);
    if (!ready) throw new Error('chromium 启动超时');
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws;

    const response = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
    const target = (await response.json()) as { webSocketDebuggerUrl: string };

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String((event as MessageEvent).data)) as {
        id?: number;
        result?: unknown;
      };
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message.result);
        this.pending.delete(message.id);
      }
    });

    this.ws = ws;
    await this.send('Network.enable');
    await this.send('Page.enable');
    return ws;
  }

  /** 取浏览器的真实 UA：WAF 会校验 cookie 与 UA 是否一致 */
  async userAgent(): Promise<string> {
    await this.launch();
    await this.connect();
    const version = (await this.send('Browser.getVersion')) as { userAgent?: string };
    return version?.userAgent ?? '';
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const ws = this.ws;
    if (!ws) throw new Error('CDP 未连接');
    const id = ++this.seq;
    const result = new Promise((resolve) => this.pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  /** 直接把 URL 交给浏览器导航，返回页面最终文本（挑战会被自动执行掉） */
  async request(url: string): Promise<string> {
    await this.launch();
    await this.connect();
    await this.send('Page.navigate', { url });

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const { result } = await this.send('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      const text = String(result?.value ?? '').trim();
      if (text.startsWith('{') || text.startsWith('[')) return text;
      await sleep(200);
    }
    throw new Error('浏览器未取到 JSON 响应');
  }

  /** 让浏览器访问一条被挑战的 URL，等它执行完 JS、拿到 cookie */
  async refresh(url: string): Promise<string> {
    await this.launch();
    await this.connect();

    await this.send('Page.navigate', { url });

    // 挑战通过后页面会变成真正的 JSON
    await waitFor(
      async () => {
        const { result } = await this.send('Runtime.evaluate', {
          expression: 'document.body ? document.body.innerText.trim().slice(0, 1) : ""',
          returnByValue: true,
        });
        return result?.value === '{' || result?.value === '[' || result?.value === 'P';
      },
      8_000,
    );

    const { cookies } = (await this.send('Network.getAllCookies')) as {
      cookies: { name: string; value: string; domain: string }[];
    };
    const relevant = cookies.filter((cookie) => cookie.domain.endsWith('flk.npc.gov.cn'));
    this.lastCookie = relevant.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    if (!this.lastCookie) throw new Error('浏览器未拿到任何 flk.npc.gov.cn cookie');
    return this.lastCookie;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.proc?.kill('SIGKILL');
    this.proc = null;
  }

  /** 进程退出时兜底清理，避免残留 chromium 抢占 profile 和端口 */
  installCleanup(): void {
    const cleanup = (): void => this.close();
    process.once('exit', cleanup);
    process.once('SIGINT', () => { cleanup(); process.exit(130); });
    process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  }
}
