#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

/**
 * docx → 规范 Markdown。
 *
 * 上游 docx 没有任何段落样式（纯直排），只能按文本模式识别结构：
 *   第X编   → ##     第X分编 → 普通段落
 *   第X章   → ###    第X节   → ####
 *   第X条   → **第X条**　正文（且全文所有"第X条"引用都加粗）
 *   目录块  → 整块丢弃
 */

const IDEO_SPACE = '\u3000';
const CLOSED_ATTRIBUTION = /[）)]\s*(\[\^[^\]]+\])?\s*$/;

/** 合并 pandoc 因排版产生的硬换行（行尾反斜杠 / 行尾中文接续） */
function joinHardBreaks(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    // 只在"下一行不是空行"时合并，否则会把段落分隔吃掉
    if (previous !== undefined && previous.endsWith('\\') && line.trim() !== '') {
      out[out.length - 1] = previous.slice(0, -1) + line.trim();
    } else {
      out.push(line);
    }
  }
  return out;
}

/** 全文"第X条"引用加粗，已加粗的不重复处理 */
function boldArticles(text: string): string {
  return text.replace(/(?<!\*)(第[一二三四五六七八九十百千零〇两]+条(?:之[一二三四五六七八九十]+)?)(?!\*)/g, '**$1**');
}

function normalizeTitle(text: string): string {
  return text.replace(/\s+/g, '').replace(/[（）()]/g, '');
}

/** 丢弃"目　　录"及其后的目录块（pandoc 把缩进的目录渲染为 blockquote） */
function dropTableOfContents(lines: string[]): string[] {
  const start = lines.findIndex((line) => /^目\s*录$/.test(line.trim()));
  if (start === -1) return lines;

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end].trim();
    if (line === '' || line.startsWith('>')) {
      end++;
      continue;
    }
    break;
  }
  return [...lines.slice(0, start), ...lines.slice(end)];
}

function renderParagraph(paragraph: string): string {
  const text = paragraph.trim();

  if (/^第[一二三四五六七八九十百千零〇两]+分编/.test(text)) return text;

  if (/^第[一二三四五六七八九十百千零〇两]+编/.test(text)) {
    return `## ${boldArticles(text)}`;
  }

  if (/^第[一二三四五六七八九十百千零〇两]+章/.test(text)) {
    return `### ${boldArticles(text)}`;
  }

  if (/^第[一二三四五六七八九十百千零〇两]+节/.test(text)) {
    return `#### ${boldArticles(text)}`;
  }

  // "附　　则"没有"第X章"前缀，但属于章级标题
  if (/^附\s*则$/.test(text)) return `### ${text}`;

  const article = text.match(/^(第[一二三四五六七八九十百千零〇两]+条(?:之[一二三四五六七八九十]+)?)[\s\u3000]*(.*)$/);
  if (article) {
    const [, number, body] = article;
    // 段落以"第X条、"这类引用开头时不是条标题，不能插全角空格
    const isHeading = body !== '' && !/^[、，。；：]/.test(body);
    return body
      ? `**${number}**${isHeading ? IDEO_SPACE : ''}${boldArticles(body)}`
      : `**${number}**`;
  }

  return boldArticles(text);
}

function isAttribution(paragraph: string): boolean {
  const text = paragraph.trim();
  if (!/^[（(]/.test(text)) return false;
  // 排除"（一）（二）"这类正文列举项
  if (/^[（(][一二三四五六七八九十]/.test(text)) return false;
  // 题注常见两种开头：括号 + 日期，或括号 + 关键词
  if (/^[（(]\s*\d{4}\s*年/.test(text)) return true;
  return /(通过|发布|公布|施行|修订|修正|批准|实施)/.test(text);
}

export function docxToMarkdown(docxPath: string, title: string): string {
  const raw = execFileSync('pandoc', [docxPath, '-t', 'markdown', '--wrap=none'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const lines = joinHardBreaks(raw.replace(/\r\n/g, '\n').split('\n'));
  const withoutToc = dropTableOfContents(lines);

  const paragraphs: string[] = [];
  let buffer: string[] = [];
  for (const line of withoutToc) {
    if (line.trim() === '') {
      if (buffer.length > 0) {
        paragraphs.push(buffer.join(''));
        buffer = [];
      }
      continue;
    }
    buffer.push(line.trim());
  }
  if (buffer.length > 0) paragraphs.push(buffer.join(''));

  // pandoc 把题注渲染为 blockquote；去掉引用符后按普通段落统一处理
  const cleaned = paragraphs.map((p) => p.replace(/^>\s?/, '').trim()).filter((p) => p !== '');

  const body: string[] = [];
  let index = 0;

  // 标题块去重：docx 里标题可能整段重复，也可能被拆成多段（甚至重复出现）
  const normalizedTitle = normalizeTitle(title);
  let fragment = '';
  for (let guard = 0; index < cleaned.length && guard < 6; guard++) {
    const candidate = normalizeTitle(cleaned[index]);
    if (candidate === '') {
      index++;
      continue;
    }
    // 整段就是标题
    if (candidate === normalizedTitle) {
      index++;
      fragment = '';
      continue;
    }
    // 标题被拆成多段，累积匹配
    if (normalizedTitle.startsWith(fragment + candidate)) {
      fragment += candidate;
      index++;
      if (fragment === normalizedTitle) fragment = '';
      continue;
    }
    break;
  }

  for (; index < cleaned.length; index++) {
    // 题注可能出现在标题/发文字号之后，且常跨段，合并到闭合括号
    if (isAttribution(cleaned[index])) {
      const start = index;
      let merged = cleaned[index];
      let closed = CLOSED_ATTRIBUTION.test(merged);
      while (!closed && index + 1 < cleaned.length && index - start < 3) {
        index++;
        merged += cleaned[index].trim();
        closed = CLOSED_ATTRIBUTION.test(merged);
      }

      if (closed) {
        const match = merged.match(/^[（(]([\s\S]*)[）)]\s*(\[\^[^\]]+\])?\s*$/);
        body.push(`> ${(match ? match[1] + (match[2] ?? '') : merged).trim()}`);
        continue;
      }
      index = start;
    }
    // 有些 docx 整章没有换行，条文会粘成一段：按条标题重新切开
    for (const piece of renderParagraph(cleaned[index]).split(
      /(?=\*\*第[零〇一二三四五六七八九十百千两]+条\*\*　)/,
    )) {
      if (piece.trim() !== '') body.push(piece);
    }
  }

  return [`# ${title.replace(/\s+/g, ' ').trim()}`, '', body.join('\n\n'), ''].join('\n');
}

const isMain = process.argv[1]?.endsWith('docx2md.ts');
if (isMain) {
  const [docx, ...rest] = process.argv.slice(2);
  const titleFlag = rest.indexOf('--title');
  const title = titleFlag >= 0 ? rest[titleFlag + 1] : '';
  if (!docx || !title) {
    console.error('用法: node scripts/docx2md.ts <file.docx> --title "法律标题"');
    process.exit(1);
  }
  process.stdout.write(docxToMarkdown(docx, title));
}
