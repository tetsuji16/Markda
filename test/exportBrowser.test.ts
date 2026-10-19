import { describe, expect, it } from 'vitest';
import { browserArgs, exportFailureMessage, findBrowserExecutable, isValidPdf, isValidPng, staticRenderedDocument, verifyRenderedHtml } from '../src/exportBrowser.js';

describe('headless browser export helpers', () => {
  it('discovers browsers on PATH after checking an explicitly configured location', async () => {
    const checked: string[] = [];
    const result = await findBrowserExecutable({
      platform: 'linux', configuredPath: 'custom-browser', pathValue: '/tools:/system',
      exists: async (candidate) => { checked.push(candidate); return candidate === '/tools/chromium'; },
    });
    expect(result).toBe('/tools/chromium');
    expect(checked[0]).toBe('custom-browser');
    expect(checked).toContain('/tools/chromium');
  });

  it('discovers per-user macOS browser installations', async () => {
    const result = await findBrowserExecutable({
      platform: 'darwin', homeDirectory: '/Users/test', pathValue: '',
      exists: async (candidate) => candidate === '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    expect(result).toBe('/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('checks common Linux installation binaries when PATH is empty', async () => {
    const result = await findBrowserExecutable({
      platform: 'linux', pathValue: '',
      exists: async (candidate) => candidate === '/opt/google/chrome/chrome',
    });
    expect(result).toBe('/opt/google/chrome/chrome');
  });

  it('finds Chrome when PATH is empty on Windows', async () => {
    const result = await findBrowserExecutable({
      platform: 'win32', pathValue: '', programFiles: 'C:\\Program Files',
      exists: async (candidate) => candidate === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    expect(result).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('uses a fresh explicit profile and temporary output for each browser export', () => {
    const args = browserArgs('pdf', '/tmp/markda/profile', 'file:///tmp/doc.html', '/tmp/markda/export.pdf');
    expect(args).toContain('--user-data-dir=/tmp/markda/profile');
    expect(args).toContain('--print-to-pdf=/tmp/markda/export.pdf');
    expect(args).not.toContain('--no-sandbox');
  });

  it('requires completed render readiness and valid newly generated output signatures', () => {
    expect(() => verifyRenderedHtml('<html data-markda-export-state="nonce:ready"><body></body></html>', 'nonce')).not.toThrow();
    expect(() => verifyRenderedHtml('<html data-markda-export-state="attacker:ready"></html>', 'nonce')).toThrow(/did not finish rendering/u);
    expect(() => verifyRenderedHtml('<html data-markda-export-state="ready"></html>', 'nonce')).toThrow(/did not finish rendering/u);
    expect(() => verifyRenderedHtml('<html data-markda-export-state="nonce:pending"></html>', 'nonce')).toThrow(/did not finish rendering/u);
    expect(() => verifyRenderedHtml('<html data-markda-export-state="nonce:error"></html>', 'nonce')).toThrow(/did not finish rendering/u);
    const staticPage = staticRenderedDocument('<html data-markda-export-state="nonce:ready"><body><script nonce="nonce">run()</script><svg></svg></body></html>', 'nonce');
    expect(staticPage).not.toContain('<script');
    expect(staticPage).toContain('<svg></svg>');
    expect(isValidPdf(Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(128)]))).toBe(true);
    expect(isValidPdf(Buffer.from('stale'))).toBe(false);
    expect(isValidPdf(undefined)).toBe(false);
    expect(isValidPng(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBe(true);
    expect(isValidPng(Buffer.from('stale'))).toBe(false);
  });

  it('shows safe actionable browser and destination errors without leaking raw process paths', () => {
    expect(exportFailureMessage(new Error('PDF export requires Chromium. Set markda.export.pdfBrowserPath.'))).toContain('PDF export requires');
    expect(exportFailureMessage(new Error('The export destination folder is unavailable or read-only.'))).toContain('read-only');
    expect(exportFailureMessage(new Error('External export command exited with code 2.'))).toBe('Export failed. Check that the browser and destination are available, then retry.');
    expect(exportFailureMessage(new Error('spawn C:\\Users\\private\\browser.exe ENOENT'))).not.toContain('private');
  });
});
