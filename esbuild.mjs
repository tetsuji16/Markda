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
    external: ['./emojiLoader.js', './katexLoader.js', './mermaidLoader.js', './yamlLoader.js'],
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    assetNames: '[name]',
  },
  {
    ...common,
    entryPoints: ['src/webview/emojiLoader.ts'],
    outfile: 'dist/emojiLoader.js',
    platform: 'browser',
    format: 'esm',
  },
  {
    ...common,
    entryPoints: ['src/webview/yamlLoader.ts'],
    outfile: 'dist/yamlLoader.js',
    platform: 'browser',
    format: 'esm',
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
    entryPoints: { mermaidLoader: 'src/webview/mermaidLoader.ts' },
    outdir: 'dist',
    platform: 'browser',
    format: 'esm',
    // Mermaid discovers diagram implementations through dynamic imports. An
    // `outfile` build collapses every implementation (including heavy
    // Cytoscape-based diagrams) into one 3.3 MB startup file. Preserve those
    // boundaries so opening a flowchart downloads and compiles only the core
    // plus the requested diagram.
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  const results = await Promise.all(builds.map((options) => esbuild.build(options)));
  // Opening the first document must not silently pull optional language
  // parsers or renderers back into the startup bundle. This budget catches the
  // exact regression where markdown() added the full HTML/CSS/JS stack.
  const webviewBytes = (await stat(new URL('./dist/webview.js', import.meta.url))).size;
  // The document-style controls, status surface, and accessible quick-insert
  // UI are part of first paint; optional parsers and renderers remain split.
  // The responsive toolbar keeps all editing controls available in compact
  // layouts; reserve a small, explicit allowance for that first-paint UI.
  const startupBundleBudget = 728 * 1024;
  if (webviewBytes > startupBundleBudget) {
    throw new Error(`Webview startup bundle is ${webviewBytes} bytes; budget is ${startupBundleBudget} bytes.`);
  }
  const extensionBytes = (await stat(new URL('./dist/extension.js', import.meta.url))).size;
  const activationBundleBudget = 64 * 1024;
  if (extensionBytes > activationBundleBudget) {
    throw new Error(`Extension activation bundle is ${extensionBytes} bytes; budget is ${activationBundleBudget} bytes.`);
  }
  const mermaidLoaderBytes = (await stat(new URL('./dist/mermaidLoader.js', import.meta.url))).size;
  const mermaidLoaderBudget = 128 * 1024;
  if (mermaidLoaderBytes > mermaidLoaderBudget) {
    throw new Error(`Mermaid entry bundle is ${mermaidLoaderBytes} bytes; budget is ${mermaidLoaderBudget} bytes.`);
  }
  const mermaidMetadata = results.find((result) =>
    Object.values(result.metafile?.outputs ?? {}).some((output) => output.entryPoint === 'src/webview/mermaidLoader.ts'),
  )?.metafile;
  if (!mermaidMetadata) throw new Error('Mermaid build metadata is missing.');
  const mermaidEntry = Object.entries(mermaidMetadata.outputs)
    .find(([, output]) => output.entryPoint === 'src/webview/mermaidLoader.ts')?.[0];
  if (!mermaidEntry) throw new Error('Mermaid entry output is missing.');
  const visited = new Set();
  const staticModuleBytes = (outputPath) => {
    if (visited.has(outputPath)) return 0;
    visited.add(outputPath);
    const output = mermaidMetadata.outputs[outputPath];
    if (!output) return 0;
    return output.bytes + output.imports
      .filter((dependency) => dependency.kind !== 'dynamic-import' && !dependency.external)
      .reduce((total, dependency) => total + staticModuleBytes(dependency.path), 0);
  };
  const mermaidStartupBytes = staticModuleBytes(mermaidEntry);
  const mermaidStartupBudget = 1024 * 1024;
  if (mermaidStartupBytes > mermaidStartupBudget) {
    throw new Error(`Mermaid startup graph is ${mermaidStartupBytes} bytes; budget is ${mermaidStartupBudget} bytes.`);
  }
}
