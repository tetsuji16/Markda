import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
if (!watch) await rm(new URL('./dist/chunks', import.meta.url), { recursive: true, force: true });
// Keep watch builds readable, but ship compact bundles. The webview is loaded in
// a fresh renderer the first time a Markdown file opens, so parse/compile cost is
// directly visible as editor startup latency.
const common = { bundle: true, sourcemap: true, minify: !watch, logLevel: 'info' };
const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'esm',
    external: ['./katexLoader.js', './mermaidLoader.js'],
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    assetNames: '[name]',
  },
  {
    ...common,
    entryPoints: ['src/webview/katexLoader.ts'],
    outfile: 'dist/katexLoader.js',
    platform: 'browser',
    format: 'esm',
  },
  {
    ...common,
    entryPoints: ['src/webview/katex.css'],
    outfile: 'dist/katex.css',
    platform: 'browser',
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    assetNames: '[name]',
  },
  {
    ...common,
    entryPoints: ['src/webview/mermaidLoader.ts'],
    outfile: 'dist/mermaidLoader.js',
    platform: 'browser',
    format: 'esm',
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
