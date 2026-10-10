import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { decodeHTML } from 'entities';
import { parseDocumentLink } from './documentLink.js';

export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

export interface LinkEdit {
  from: number;
  to: number;
  insert: string;
}

export interface PathRename {
  oldPath: string;
  newPath: string;
}

const linkParser = new MarkdownIt();

function excluded(text: string): boolean[] {
  const mask = Array<boolean>(text.length).fill(false);
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu) ?? [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length;
  }
  offset = 0;

  // Parser maps include fences and indented blocks nested in blockquotes and lists.
  const tokens = linkParser.parse(text, {});
  for (const token of tokens) {
    if ((token.type !== 'fence' && token.type !== 'code_block') || !token.map) continue;
    const from = offsets[token.map[0]];
    const lastLine = token.map[1] - 1;
    const to = lastLine >= 0 ? offsets[lastLine]! + lines[lastLine]!.length : from;
    if (from !== undefined) mask.fill(true, from, to);
  }

  let frontMatter = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const body = line.replace(/[\r\n]+$/u, '');
    if (index === 0 && body === '---') frontMatter = true;
    if (frontMatter) {
      mask.fill(true, offset, offset + line.length);
      if (index > 0 && /^(?:---|\.\.\.)\s*$/u.test(body)) frontMatter = false;
      offset += line.length;
      continue;
    }
    offset += line.length;
  }

  // Comments and code spans can cross line boundaries, so scan after block masking.
  for (let i = 0; i < text.length;) {
    if (mask[i]) { i++; continue; }
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const end = close < 0 ? text.length : close + 3;
      mask.fill(true, i, end);
      i = end;
      continue;
    }
    if (text[i] === '`') {
      let size = 1;
      while (text[i + size] === '`') size++;
      let close = i + size;
      let match = -1;
      while (close < text.length) {
        if (mask[close]) { close++; continue; }
        if (text[close] !== '`') { close++; continue; }
        let run = 1;
        while (text[close + run] === '`') run++;
        if (run === size) { match = close; break; }
        close += run;
      }
      if (match >= 0) {
        mask.fill(true, i, match + size);
        i = match + size;
        continue;
      }
      i += size;
      continue;
    }
    i++;
  }
  return mask;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** Finds local inline destinations and reference-definition destinations. Ranges omit angle brackets. */
export function extractLocalLinks(text: string): LinkRange[] {
  const mask = excluded(text);
  const links: LinkRange[] = [];
  const add = (from: number, to: number) => {
    if (from >= to || mask.slice(from, to).some(Boolean)) return;
    const href = decodeHTML(text.slice(from, to).replace(/\\([()<>\\])/gu, '$1'));
    const key = `${from}:${to}`;
    if (!links.some(link => `${link.from}:${link.to}` === key)
      && parseDocumentLink(href).kind !== 'external'
      && parseDocumentLink(href).kind !== 'unsupported') {
      links.push({ from, to, href });
    }
  };

  const definition = /(?:^|\r\n|\r|\n) {0,3}\[[^\]\r\n]+\]:[ \t]*(<[^>\r\n]*>|[^\s\r\n]+)(?=[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))?[ \t]*(?:\r\n|\r|\n|$))/gu;
  for (const match of text.matchAll(definition)) {
    const raw = match[1]!;
    const from = (match.index ?? 0) + match[0].length - raw.length;
    const angle = raw.startsWith('<') && raw.endsWith('>');
    add(from + Number(angle), from + raw.length - Number(angle));
  }

  for (let close = 0; close < text.length; close++) {
    if (mask[close] || text[close] !== ']' || isEscaped(text, close)) continue;
    let bracketDepth = 0;
    let opening = -1;
    for (let index = close - 1; index >= 0; index--) {
      if (mask[index]) continue;
      if (text[index] === ']' && !isEscaped(text, index)) bracketDepth++;
      else if (text[index] === '[' && !isEscaped(text, index)) {
        if (bracketDepth === 0) { opening = index; break; }
        bracketDepth--;
      }
    }
    if (opening < 0) continue;
    let cursor = close + 1;
    while (cursor < text.length && /[ \t\r\n]/u.test(text[cursor]!)) cursor++;
    if (text[cursor] !== '(') continue;
    cursor++;
    while (cursor < text.length && /[ \t\r\n]/u.test(text[cursor]!)) cursor++;
    let from = cursor;
    let to = cursor;
    if (text[cursor] === '<') {
      from = ++cursor;
      while (cursor < text.length && text[cursor] !== '>' && !/[\r\n]/u.test(text[cursor]!)) cursor++;
      if (text[cursor] !== '>') continue;
      to = cursor++;
    } else {
      let depth = 0;
      while (cursor < text.length && !/[\s]/u.test(text[cursor]!)) {
        if (!isEscaped(text, cursor) && text[cursor] === '(') depth++;
        else if (!isEscaped(text, cursor) && text[cursor] === ')') {
          if (depth === 0) break;
          depth--;
        }
        cursor++;
      }
      if (depth !== 0) continue;
      to = cursor;
    }
    // The optional title may be single/double quoted or parenthesized and can have whitespace.
    while (cursor < text.length && /[ \t\r\n]/u.test(text[cursor]!)) cursor++;
    if (text[cursor] === '"' || text[cursor] === "'") {
      const quote = text[cursor++]!;
      while (cursor < text.length && (text[cursor] !== quote || isEscaped(text, cursor))) cursor++;
      if (text[cursor] !== quote) continue;
      cursor++;
    } else if (text[cursor] === '(') {
      cursor++;
      while (cursor < text.length && (text[cursor] !== ')' || isEscaped(text, cursor))) cursor++;
      if (text[cursor] !== ')') continue;
      cursor++;
    }
    while (cursor < text.length && /[ \t\r\n]/u.test(text[cursor]!)) cursor++;
    if (text[cursor] === ')') add(from, to);
  }
  return links.sort((a, b) => a.from - b.from);
}

function pathApi(value: string): typeof path.posix {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.includes('\\') ? path.win32 : path.posix;
}

function canonical(value: string, api: typeof path.posix): string {
  return api.normalize(api.isAbsolute(value) ? value : api.resolve(value));
}

function applyRename(value: string, renames: PathRename[], api: typeof path.posix): string {
  const resolved = canonical(value, api);
  const candidates = renames
    .map(rename => ({ oldPath: canonical(rename.oldPath, api), newPath: canonical(rename.newPath, api) }))
    .filter(rename => resolved === rename.oldPath || resolved.startsWith(rename.oldPath + api.sep))
    .sort((a, b) => b.oldPath.length - a.oldPath.length);
  const match = candidates[0];
  return match ? api.join(match.newPath, api.relative(match.oldPath, resolved)) : resolved;
}

function encodePath(value: string): string {
  return value.split('/').map((part, index) => index === 0 && part === '..' ? part : encodeURIComponent(part)).join('/');
}

/** Rewrites relative links affected by file/folder renames, including a move of the source document. */
export function renameLinkEdits(text: string, sourcePath: string, renames: PathRename[]): LinkEdit[] {
  const api = pathApi(sourcePath);
  const oldSource = canonical(sourcePath, api);
  const newSource = applyRename(oldSource, renames, api);
  const oldDir = api.dirname(oldSource);
  const newDir = api.dirname(newSource);
  const edits: LinkEdit[] = [];

  for (const link of extractLocalLinks(text)) {
    const target = parseDocumentLink(link.href);
    if (target.kind === 'anchor') continue;
    if (target.kind !== 'local') continue;
    const rawHref = text.slice(link.from, link.to);
    const pathPart = link.href.split(/[?#]/u, 1)[0]!;
    const suffix = link.href.slice(pathPart.length);
    const absoluteTarget = api.isAbsolute(target.path) ? canonical(target.path, api) : canonical(api.resolve(oldDir, target.path), api);
    const movedTarget = applyRename(absoluteTarget, renames, api);
    if (absoluteTarget === movedTarget && oldDir === newDir) continue;
    const replacement = api.relative(newDir, movedTarget).replace(/\\/gu, '/');
    const relativeWithPrefix = pathPart.startsWith('./') && !replacement.startsWith('../') && replacement !== '.'
      ? `./${replacement}`
      : replacement;
    const insert = `${pathPart.startsWith('/') ? movedTarget.replace(/\\/gu, '/') : encodePath(relativeWithPrefix)}${suffix}`;
    // Preserve backslash escaping for destinations that used escaped punctuation.
    const escapedInsert = rawHref.includes('\\(') ? insert.replace(/\(/gu, '\\(').replace(/\)/gu, '\\)') : insert;
    if (escapedInsert === rawHref) continue;
    edits.push({ from: link.from, to: link.to, insert: escapedInsert });
  }
  return edits;
}
