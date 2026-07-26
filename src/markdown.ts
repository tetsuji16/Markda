import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';
import { full as emoji } from 'markdown-it-emoji';
import katex from 'katex';
import { collectMathReferences, installDocumentFeatures, prepareMathExpression } from './markdownFeatures.js';

export interface RenderOptions {
  breaks?: boolean;
  /**
   * Allow raw HTML passthrough. Consistent with the live preview policy: raw HTML is
   * emitted only when both `markdown.html` is enabled and `security.allowUnsafeHtml`
   * is opted into. Otherwise HTML is stripped to avoid injecting untrusted markup.
   */
  html?: boolean;
}

export function createMarkdownRenderer(options: RenderOptions = {}): MarkdownIt {
  const renderer = new MarkdownIt({
    breaks: options.breaks ?? false,
    html: options.html ?? false,
    linkify: true,
    typographer: false,
  });
  renderer.use(footnote).use(mark).use(sub).use(sup).use(taskLists, { enabled: true, label: true }).use(emoji);
  installDocumentFeatures(renderer);
  let mathReferences = collectMathReferences('');
  renderer.inline.ruler.after('escape', 'markda_math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    const end = state.src.indexOf('$', state.pos + 1);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('markda_math_inline', 'math', 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  renderer.renderer.rules.markda_math_inline = (tokens, index) => renderMath(tokens[index]?.content ?? '', false, mathReferences);
  const defaultFence = renderer.renderer.rules.fence;
  renderer.renderer.rules.fence = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    if (/^(?:math|latex)$/iu.test(token?.info.trim() ?? '')) {
      return `<div class="markda-math-block">${renderMath(token?.content ?? '', true, mathReferences)}</div>\n`;
    }
    return defaultFence
      ? defaultFence(tokens, index, renderOptions, env, self)
      : `<pre><code>${renderer.utils.escapeHtml(token?.content ?? '')}</code></pre>\n`;
  };
  const baseRender = renderer.render.bind(renderer);
  renderer.render = (source, env) => {
    mathReferences = collectMathReferences(source);
    return baseRender(normalizeMathBlocks(source), env);
  };
  const defaultLinkOpen = renderer.renderer.rules.link_open
    ?? ((tokens, index, renderOptions, _env, self) => self.renderToken(tokens, index, renderOptions));
  renderer.renderer.rules.link_open = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    token?.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, index, renderOptions, env, self);
  };
  return renderer;
}

function normalizeMathBlocks(source: string): string {
  return source.replace(/^\$\$[ \t]*\r?\n([\s\S]*?)\r?\n\$\$[ \t]*$/gmu, (_match, expression: string) => `\`\`\`math\n${expression}\n\`\`\``);
}

function renderMath(
  source: string,
  displayMode: boolean,
  references: ReturnType<typeof collectMathReferences>,
): string {
  return katex.renderToString(prepareMathExpression(source, references, displayMode), {
    displayMode,
    throwOnError: false,
    strict: 'warn',
    trust: false,
    output: 'htmlAndMathml',
  });
}

export function extractTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return heading || fallback;
}
