import * as esbuild from 'esbuild';
import { rm, stat } from 'node:fs/promises';

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
    // Keep exportService as a real runtime boundary. Without externalizing this
    // relative import, esbuild folds MarkdownIt and its entity tables into the
    // activation bundle even though extension.ts uses dynamic import().
    external: ['vscode', './exportService.js'],
  },
  {
    ...common,
    entryPoints: ['src/exportService.ts'],
    outfile: 'dist/exportService.js',
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
  // Opening the first document must not silently pull optional language
  // parsers or renderers back into the startup bundle. This budget catches the
  // exact regression where markdown() added the full HTML/CSS/JS stack.
  const webviewBytes = (await stat(new URL('./dist/webview.js', import.meta.url))).size;
  const startupBundleBudget = 700 * 1024;
  if (webviewBytes > startupBundleBudget) {
    throw new Error(`Webview startup bundle is ${webviewBytes} bytes; budget is ${startupBundleBudget} bytes.`);
  }
  const extensionBytes = (await stat(new URL('./dist/extension.js', import.meta.url))).size;
  const activationBundleBudget = 64 * 1024;
  if (extensionBytes > activationBundleBudget) {
    throw new Error(`Extension activation bundle is ${extensionBytes} bytes; budget is ${activationBundleBudget} bytes.`);
  }
}
