export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

export type HistoryShortcut = 'undo' | 'redo';

/**
 * Recognizes document-history shortcuts used while focus is inside one of the
 * live preview's contenteditable widgets. IME composition owns its keystrokes,
 * and Alt-modified shortcuts are deliberately left to the platform.
 */
export function historyShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>): HistoryShortcut | undefined {
  if (event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey)) return undefined;
  const key = event.key.toLocaleLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return undefined;
}

/**
 * Typora-style live-mode line breaks. Source mode and structural Markdown
 * blocks keep CodeMirror's native behavior; prose gets a real paragraph break.
 */
export function liveEnterEdit(text: string, position: number, shiftKey: boolean, insideFence = false): TextEdit | undefined {
  const safePosition = Math.max(0, Math.min(position, text.length));
  const eol = text.match(/\r\n|\r|\n/u)?.[0] ?? '\n';
  const lineStart = Math.max(text.lastIndexOf('\n', safePosition - 1) + 1, text.lastIndexOf('\r', safePosition - 1) + 1);
  let lineEnd = text.indexOf('\n', safePosition);
  if (lineEnd < 0) lineEnd = text.length;
  if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd--;
  const line = text.slice(lineStart, lineEnd);
  const before = text.slice(lineStart, safePosition);

  if (insideFence || isInsideFence(text, safePosition)) return undefined;
  if (shiftKey) {
    const insert = before.endsWith('  ') ? eol : `  ${eol}`;
    return { from: safePosition, to: safePosition, insert, cursor: safePosition + insert.length };
  }

  // Lists, quotes, fences, HTML blocks, headings and thematic rules have their
  // own Markdown continuation/termination behavior in CodeMirror.
  if (/^\s*(?:[-+*]\s|\d+[.)]\s|>\s?|```|~~~|#{1,6}\s|<|(?:[-*_]\s*){3,})/u.test(line)) return undefined;
  if (!line.trim()) return undefined;

  const after = text.slice(safePosition, lineEnd);
  const atLineEnd = after.length === 0;
  const nextBreak = text.slice(lineEnd).match(/^(?:\r\n|\r|\n)/u)?.[0] ?? '';
  const followingIsBlank = nextBreak
    ? /^(?:\r\n|\r|\n)/u.test(text.slice(lineEnd + nextBreak.length))
    : false;
  const insert = atLineEnd && followingIsBlank ? nextBreak || eol : `${eol}${eol}`;
  return { from: safePosition, to: safePosition, insert, cursor: safePosition + insert.length };
}

function isInsideFence(text: string, position: number): boolean {
  let fence = '';
  for (const line of text.slice(0, position).split(/\r\n|\r|\n/u)) {
    const marker = line.match(/^\s*(```|~~~)/u)?.[1] ?? '';
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker === fence) fence = '';
  }
  return Boolean(fence);
}

/** Keeps contenteditable commits out of the IME composition window. */
export class CompositionCommitGate {
  private composing = false;
  private pending = false;

  start(): void { this.composing = true; }

  request(commit: () => void): boolean {
    if (this.composing) {
      this.pending = true;
      return false;
    }
    commit();
    return true;
  }

  end(commit: () => void): void {
    this.composing = false;
    if (!this.pending) return;
    this.pending = false;
    commit();
  }

  flush(commit: () => void): void {
    this.composing = false;
    this.pending = false;
    commit();
  }
}

export function htmlFragmentToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return domFragmentToMarkdown(parsed.body);
}

export function domFragmentToMarkdown(parent: ParentNode): string {
  return childrenToMarkdown(parent).replace(/\n{3,}/gu, '\n\n').trim();
}

function childrenToMarkdown(parent: ParentNode): string {
  return Array.from(parent.childNodes).map((node) => nodeToMarkdown(node)).join('');
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/gu, ' ');
  if (!(node instanceof HTMLElement)) return '';
  const content = childrenToMarkdown(node);
  switch (node.tagName.toLowerCase()) {
    case 'p': case 'div': case 'section': case 'article': return `${content.trim()}\n\n`;
    case 'br': return '  \n';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return `${'#'.repeat(Number(node.tagName[1]))} ${content.trim()}\n\n`;
    case 'strong': case 'b': return `**${content}**`;
    case 'em': case 'i': return `*${content}*`;
    case 'del': case 's': case 'strike': return `~~${content}~~`;
    case 'mark': return `==${content}==`;
    case 'code': return node.parentElement?.tagName.toLowerCase() === 'pre' ? content : `\`${content}\``;
    case 'pre': return `\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`;
    case 'a': {
      const href = node.getAttribute('href') ?? '';
      return href ? `[${content || href}](${href.replaceAll(' ', '%20')})` : content;
    }
    case 'img': {
      const source = node.getAttribute('src') ?? '';
      return source ? `![${node.getAttribute('alt') ?? ''}](${source.replaceAll(' ', '%20')})` : '';
    }
    case 'blockquote': return `${content.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    case 'ul': return listToMarkdown(node, false);
    case 'ol': return listToMarkdown(node, true);
    case 'table': return tableToMarkdown(node);
    case 'li': return content;
    default: return content;
  }
}

function listToMarkdown(list: HTMLElement, ordered: boolean): string {
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  return `${items.map((item, index) => {
    const content = childrenToMarkdown(item).trim().replace(/\n/gu, '\n  ');
    return `${ordered ? `${index + 1}.` : '-'} ${content}`;
  }).join('\n')}\n\n`;
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
      (cell.textContent ?? '').replaceAll('|', '\\|').replace(/\s+/gu, ' ').trim()));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  return `${formatTableRow(normalized[0] ?? [])}\n${formatTableRow(Array.from({ length: width }, () => '---'))}\n${normalized.slice(1).map(formatTableRow).join('\n')}\n\n`;
}

function formatTableRow(row: string[]): string { return `| ${row.join(' | ')} |`; }
