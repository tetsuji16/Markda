import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';

export interface RenderOptions {
  breaks?: boolean;
  html?: boolean;
}

export function createMarkdownRenderer(options: RenderOptions = {}): MarkdownIt {
  const renderer = new MarkdownIt({
    breaks: options.breaks ?? false,
    html: options.html ?? false,
    linkify: true,
    typographer: false,
  });
  renderer.use(footnote).use(mark).use(sub).use(sup).use(taskLists, { enabled: true, label: true });
  const defaultLinkOpen = renderer.renderer.rules.link_open
    ?? ((tokens, index, renderOptions, _env, self) => self.renderToken(tokens, index, renderOptions));
  renderer.renderer.rules.link_open = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    token?.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, index, renderOptions, env, self);
  };
  return renderer;
}

export function extractTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return heading || fallback;
}
