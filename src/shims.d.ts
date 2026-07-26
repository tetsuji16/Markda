declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module '*.css';

declare module '*.md?raw' {
  const source: string;
  export default source;
}

declare module 'markdown-it-sub' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module 'markdown-it-sup' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const plugin: MarkdownIt.PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it';
  export const full: MarkdownIt.PluginSimple;
  export const light: MarkdownIt.PluginSimple;
}

declare module 'markdown-it-emoji/lib/data/full.mjs' {
  const emoji: Readonly<Record<string, string>>;
  export default emoji;
}

declare module 'markdown-it-emoji/lib/data/light.mjs' {
  const emoji: Readonly<Record<string, string>>;
  export default emoji;
}
