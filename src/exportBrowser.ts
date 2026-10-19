import * as path from 'node:path';
import * as os from 'node:os';
import { access, constants, stat } from 'node:fs/promises';

export interface BrowserDiscoveryOptions {
  configuredPath?: string;
  platform?: NodeJS.Platform;
  pathValue?: string;
  pathExt?: string;
  programFiles?: string;
  programFilesX86?: string;
  localAppData?: string;
  homeDirectory?: string;
  exists?: (candidate: string) => Promise<boolean>;
}

export async function findBrowserExecutable(options: BrowserDiscoveryOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const separator = platform === 'win32' ? ';' : ':';
  const pathExt = platform === 'win32' ? (options.pathExt ?? '.EXE;.BAT;.CMD') : '';
  const extensions = pathExt.split(';').filter(Boolean);
  const names = platform === 'win32' ? ['msedge.exe', 'chrome.exe', 'chromium.exe']
    : platform === 'darwin' ? ['microsoft-edge', 'Google Chrome', 'chromium', 'chromium-browser']
      : ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const roots = platform === 'win32'
    ? [options.programFiles ?? process.env['PROGRAMFILES'], options.programFilesX86 ?? process.env['PROGRAMFILES(X86)'], options.localAppData ?? process.env['LOCALAPPDATA']].filter((value): value is string => Boolean(value))
      .flatMap((root) => [pathApi.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), pathApi.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    : platform === 'darwin'
      ? [options.homeDirectory ? pathApi.join(options.homeDirectory, 'Applications') : pathApi.join(os.homedir(), 'Applications'), '/Applications']
        .flatMap((root) => [pathApi.join(root, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), pathApi.join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'), pathApi.join(root, 'Chromium.app/Contents/MacOS/Chromium')])
      : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/chromium', '/snap/bin/chromium',
        '/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'];
  const searchPath = (options.pathValue ?? process.env['PATH'] ?? '').split(separator).filter(Boolean)
    .flatMap((folder) => names.flatMap((name) => extensions.length && !pathApi.extname(name)
      ? extensions.map((extension) => pathApi.join(folder, name + extension)) : [pathApi.join(folder, name)]));
  const candidates = [...(options.configuredPath?.trim() ? [options.configuredPath.trim()] : []), ...roots, ...searchPath];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (options.exists) {
        if (!await options.exists(candidate)) continue;
      } else {
        await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        if (!(await stat(candidate)).isFile()) continue;
      }
      return candidate;
    } catch { /* Try the next installed browser. */ }
  }
  return undefined;
}

export function browserArgs(kind: 'pdf' | 'screenshot' | 'probe', userDataDirectory: string, pageUrl: string, outputPath?: string, width?: number, height?: number): string[] {
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', `--user-data-dir=${userDataDirectory}`,
  ];
  if (kind === 'pdf') args.push('--no-pdf-header-footer', `--print-to-pdf=${outputPath}`);
  if (kind === 'screenshot') args.push('--hide-scrollbars', '--virtual-time-budget=25000', `--window-size=${width},${height}`, `--screenshot=${outputPath}`);
  if (kind === 'probe') args.push('--hide-scrollbars', '--virtual-time-budget=25000', `--window-size=${width},720`, '--dump-dom');
  if (kind !== 'pdf') args.push('--disable-gpu');
  if (kind === 'pdf') args.push('--virtual-time-budget=25000');
  args.push(pageUrl);
  return args;
}

export function verifyRenderedHtml(dom: string, nonce: string): void {
  const root = /<html\b[^>]*>/iu.exec(dom)?.[0] ?? '';
  const state = /\sdata-markda-export-state="([^"]*)"/u.exec(root)?.[1];
  if (state !== `${nonce}:ready`) throw new Error('Mermaid diagrams or page assets did not finish rendering. Check diagram syntax and local image paths, then retry the export.');
}

export function staticRenderedDocument(dom: string, nonce: string): string {
  verifyRenderedHtml(dom, nonce);
  const scriptTag = new RegExp(`<script\\s+nonce="${nonce}"[^>]*>[\\s\\S]*?<\\/script\\s*>`, 'giu');
  return dom.replace(scriptTag, '');
}

export function isValidPdf(data: Uint8Array | undefined): data is Uint8Array {
  return Boolean(data && data.length >= 100 && Buffer.from(data).subarray(0, 5).equals(Buffer.from('%PDF-')));
}

export function isValidPng(data: Uint8Array | undefined): data is Uint8Array {
  return Boolean(data && data.length >= 8 && Buffer.from(data).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
}

export function exportFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^(?:PDF export requires|Image export requires|The export destination folder|The bundled Mermaid renderer|Mermaid diagrams or page assets|The browser did not create a valid (?:PDF|PNG)|The browser could not finish preparing the image export|Mermaid render error:)/u.test(message)) return message;
  return 'Export failed. Check that the browser and destination are available, then retry.';
}

export async function browserWorkingDirectory(documentPath: string | undefined): Promise<string> {
  if (documentPath) {
    try { await access(documentPath, constants.F_OK); return documentPath; } catch { /* A non-local or deleted document uses the temporary directory. */ }
  }
  return os.tmpdir();
}
