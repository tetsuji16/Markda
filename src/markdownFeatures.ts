import type MarkdownIt from 'markdown-it';

export interface HeadingAnchor {
  readonly level: number;
  readonly text: string;
  readonly slug: string;
  readonly from: number;
}

export interface MathReferences {
  readonly labels: ReadonlyMap<string, string>;
}

export function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/<[^>]*>/gu, '')
    .replace(/[`*_~=[\]{}()<>#!.,:;?'"\\/+|]/gu, '')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '') || 'section';
}

export function headingAnchors(markdown: string): readonly HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  const counts = new Map<string, number>();
  const lines = markdown.split(/\r\n|\r|\n/gu);
  let offset = 0;
  let fence: string | undefined;
  let frontMatter = lines[0]?.trim() === '---';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (frontMatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line)) frontMatter = false;
      offset += line.length + 1;
      continue;
    }
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      offset += line.length + 1;
      continue;
    }
    if (fence) {
      offset += line.length + 1;
      continue;
    }
    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    const setext = index + 1 < lines.length && line.trim()
      ? (lines[index + 1] ?? '').match(/^\s{0,3}(=+|-+)\s*$/u)
      : undefined;
    const text = atx?.[2] ?? (setext ? line.trim() : undefined);
    if (text) {
      const level = atx ? atx[1]!.length : setext![1]!.startsWith('=') ? 1 : 2;
      const base = slugifyHeading(stripInlineMarkdown(text));
      const occurrence = counts.get(base) ?? 0;
      counts.set(base, occurrence + 1);
      anchors.push({ level, text: stripInlineMarkdown(text), slug: occurrence ? `${base}-${occurrence}` : base, from: offset });
    }
    offset += line.length + 1;
  }
  return anchors;
}

export function installDocumentFeatures(renderer: MarkdownIt): void {
  renderer.core.ruler.after('inline', 'markda-document-features', (state) => {
    const headingCounts = new Map<string, number>();
    const headings: HeadingAnchor[] = [];
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token?.type !== 'heading_open') continue;
      const inline = state.tokens[index + 1];
      const text = inline?.type === 'inline' ? stripInlineMarkdown(inline.content) : '';
      const base = slugifyHeading(text);
      const occurrence = headingCounts.get(base) ?? 0;
      headingCounts.set(base, occurrence + 1);
      const slug = occurrence ? `${base}-${occurrence}` : base;
      token.attrSet('id', slug);
      headings.push({ level: Number(token.tag.slice(1)) || 1, text, slug, from: token.map?.[0] ?? 0 });
    }
    for (let index = 0; index < state.tokens.length - 2; index++) {
      const open = state.tokens[index];
      const inline = state.tokens[index + 1];
      const close = state.tokens[index + 2];
      if (open?.type !== 'paragraph_open' || inline?.type !== 'inline'
        || close?.type !== 'paragraph_close' || !/^\s*\[toc\]\s*$/iu.test(inline.content)) continue;
      const token = new state.Token('html_block', '', 0);
      token.block = true;
      token.content = tocHtml(headings, renderer);
      state.tokens.splice(index, 3, token);
    }
  });
}

export function collectMathReferences(markdown: string): MathReferences {
  const labels = new Map<string, string>();
  let ordinal = 0;
  for (const expression of displayMathExpressions(markdown)) {
    const label = expression.match(/\\label\{([^{}]+)\}/u)?.[1];
    if (!label || labels.has(label)) continue;
    ordinal++;
    labels.set(label, expression.match(/\\tag\{([^{}]+)\}/u)?.[1] ?? String(ordinal));
  }
  return { labels };
}

export function prepareMathExpression(
  expression: string,
  references: MathReferences,
  displayMode: boolean,
): string {
  const ownLabel = expression.match(/\\label\{([^{}]+)\}/u)?.[1];
  let prepared = expression
    .replace(/\\label\{[^{}]+\}/gu, '')
    .replace(/\\(?:eq)?ref\{([^{}]+)\}/gu, (match, label: string) => {
      const value = references.labels.get(label);
      return value ? (String(match).startsWith('\\eqref') ? `(${value})` : value) : '??';
    });
  if (displayMode && ownLabel && !/\\tag\{[^{}]+\}/u.test(prepared)) {
    prepared = `${prepared.trimEnd()}\\tag{${references.labels.get(ownLabel) ?? '?'}}`;
  }
  return prepared;
}

function tocHtml(headings: readonly HeadingAnchor[], renderer: MarkdownIt): string {
  if (!headings.length) return '<nav class="markda-toc" aria-label="Table of contents"></nav>\n';
  const minimum = Math.min(...headings.map((heading) => heading.level));
  const items = headings.map((heading) => {
    const depth = Math.max(0, heading.level - minimum);
    return `<li class="markda-toc-level-${depth}"><a href="#${renderer.utils.escapeHtml(heading.slug)}">${renderer.utils.escapeHtml(heading.text)}</a></li>`;
  }).join('');
  return `<nav class="markda-toc" aria-label="Table of contents"><ul>${items}</ul></nav>\n`;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[`*_~^=]/gu, '')
    .trim();
}

function displayMathExpressions(markdown: string): readonly string[] {
  const expressions: string[] = [];
  for (const match of markdown.matchAll(/\$\$\s*([\s\S]*?)\s*\$\$/gu)) expressions.push(match[1] ?? '');
  for (const match of markdown.matchAll(/^(?:```|~~~)(?:math|latex)\s*\r?\n([\s\S]*?)\r?\n(?:```|~~~)\s*$/gimu)) {
    expressions.push(match[1] ?? '');
  }
  return expressions;
}
