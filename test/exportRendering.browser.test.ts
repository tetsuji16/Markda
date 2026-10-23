/// <reference types="@vitest/browser/providers/playwright" />
/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { cdp } from '@vitest/browser/context';
import exportMermaidBundle from '../dist/exportMermaid.js?raw';
import katexCss from '../dist/katex.css?raw';
import { browserExportContentSecurityPolicy, createHtmlDocument, exportContentFitCss, exportReadinessScript, heightProbeScript, mermaidExportScript, parseProbedHeight, pdfPageCss } from '../src/htmlExport.js';

describe('browser-based document export rendering', () => {
  it('wraps styled HTML and PDF print content while keeping screen scrolling unchanged', async () => {
    const longToken = 'x'.repeat(1200);
    const equation = katex.renderToString(`\\displaystyle ${Array.from({ length: 60 }, (_, index) => `x_{${index + 1}}`).join(' + ')}`, {
      displayMode: true,
      throwOnError: false,
    });
    const columns = Array.from({ length: 30 }, (_, index) => `<th>Header ${index + 1}</th>`).join('');
    const values = Array.from({ length: 30 }, (_, index) => `<td>Value ${index + 1}</td>`).join('');
    const body = `<p id="long-url">https://example.invalid/${longToken}</p>`
      + `<p id="inline-code"><code>${longToken}</code></p>`
      + `<table id="long-cell"><tr><td>Value</td><td><code>${longToken}</code></td></tr></table>`
      + '<table id="two-columns"><tr><th>Name</th><th>Description</th></tr><tr><td>Item</td><td>A readable description.</td></tr></table>'
      + '<table id="five-columns"><tr><th>Name</th><th>Type</th><th>Status</th><th>Owner</th><th>Description</th></tr><tr><td>Item</td><td>Text</td><td>Ready</td><td>Team</td><td>A readable description.</td></tr></table>'
      + `<table id="many-columns"><tr>${columns}</tr><tr>${values}</tr></table>`
      + `<pre id="long-code"><code>${longToken}</code></pre>${equation}`;
    const htmlDocuments = [
      createHtmlDocument('Styled HTML print', body, 'en', katexCss),
      createHtmlDocument('PDF print', body, 'en', `${katexCss}\n${pdfPageCss('A4', 15)}`),
    ];
    const frames = htmlDocuments.map((html) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'width:680px;height:900px;border:0';
      frame.srcdoc = html;
      document.body.append(frame);
      return frame;
    });
    const waitForLoad = (frame: HTMLIFrameElement) => new Promise<void>((resolve, reject) => {
      if (frame.contentDocument?.querySelector('#long-code')) return resolve();
      const timeout = setTimeout(() => reject(new Error('Print regression iframe did not load.')), 10_000);
      frame.addEventListener('load', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
    const media = cdp();
    try {
      await Promise.all(frames.map(waitForLoad));
      await Promise.all(frames.map((frame) => frame.contentDocument!.fonts.ready));
      for (const frame of frames) {
        const pre = frame.contentDocument!.querySelector<HTMLElement>('#long-code')!;
        const wideTable = frame.contentDocument!.querySelector<HTMLTableElement>('#many-columns')!;
        const displayMath = frame.contentDocument!.querySelector<HTMLElement>('.katex-display>.katex')!;
        expect(getComputedStyle(pre).overflow).toBe('auto');
        expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
        expect(getComputedStyle(wideTable).tableLayout).toBe('auto');
        expect(getComputedStyle(displayMath).whiteSpace).toBe('nowrap');
      }

      await media.send('Emulation.setEmulatedMedia', { media: 'print' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      for (const frame of frames) {
        const exported = frame.contentDocument!;
        const main = exported.querySelector<HTMLElement>('.markda-export')!;
        const pre = exported.querySelector<HTMLElement>('#long-code')!;
        const wideTable = exported.querySelector<HTMLTableElement>('#many-columns')!;
        const displayMathContent = exported.querySelector<HTMLElement>('.katex-display>.katex')!;
        expect(getComputedStyle(wideTable).tableLayout).toBe('fixed');
        expect(getComputedStyle(pre).overflow).toBe('visible');
        expect(getComputedStyle(pre, '::-webkit-scrollbar').display).toBe('none');
        expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth);
        expect(exported.documentElement.scrollWidth).toBeLessThanOrEqual(exported.documentElement.clientWidth);
        for (const id of ['long-url', 'inline-code', 'long-cell']) {
          const element = exported.getElementById(id)!;
          expect(element.scrollWidth, `${id} must wrap within the print width`).toBeLessThanOrEqual(element.clientWidth);
        }
        expect(wideTable.getBoundingClientRect().width).toBeLessThanOrEqual(main.clientWidth);
        expect([...wideTable.querySelectorAll('th,td')].every((cell) => cell.scrollWidth <= cell.clientWidth)).toBe(true);
        expect(getComputedStyle(displayMathContent).whiteSpace).toBe('normal');
        for (const id of ['two-columns', 'five-columns']) {
          const table = exported.getElementById(id)!;
          expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(main.clientWidth);
          expect([...table.querySelectorAll('th,td')].every((cell) => cell.scrollWidth <= cell.clientWidth)).toBe(true);
        }
        const displayMath = exported.querySelector<HTMLElement>('.katex-display')!;
        expect(displayMath.scrollWidth).toBeLessThanOrEqual(displayMath.clientWidth);
      }
    } finally {
      await media.send('Emulation.setEmulatedMedia', { media: 'screen' });
      frames.forEach((frame) => frame.remove());
    }
  });

  it('fits image probe and capture content to the configured width', async () => {
    const nonce = 'image-fit-test';
    const longToken = 'x'.repeat(1200);
    const equation = katex.renderToString(`\\displaystyle ${Array.from({ length: 60 }, (_, index) => `x_{${index + 1}}`).join(' + ')}`, {
      displayMode: true,
      throwOnError: false,
    });
    const columns = Array.from({ length: 30 }, (_, index) => `<th>Header ${index + 1}</th>`).join('');
    const values = Array.from({ length: 30 }, (_, index) => `<td>Value ${index + 1}</td>`).join('');
    const body = `<p id="long-url">https://example.invalid/${longToken}</p>`
      + `<p id="inline-code"><code>${longToken}</code></p>`
      + `<table id="many-columns"><tr>${columns}</tr><tr>${values}</tr></table>`
      + `<pre id="long-code"><code>${longToken}</code></pre>${equation}`;
    const html = createHtmlDocument('Image export', body, 'en',
      `${katexCss}\nbody{font-size:18px}.markda-export{max-width:820px;padding:40px}${exportContentFitCss()}`,
      '',
      browserExportContentSecurityPolicy(false, nonce),
      `${exportReadinessScript(nonce)}${heightProbeScript(nonce)}`);
    const probeFrame = document.createElement('iframe');
    probeFrame.style.cssText = 'width:900px;height:1000px;border:0';
    probeFrame.srcdoc = html;
    document.body.append(probeFrame);
    let captureFrame: HTMLIFrameElement | undefined;
    const waitForImageProbe = async (frame: HTMLIFrameElement) => {
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 10_000;
        const poll = () => {
          const root = frame.contentDocument?.documentElement;
          if (root?.dataset.markdaExportState === `${nonce}:ready`
            && root.getAttribute('data-markda-height')?.startsWith(`${nonce}:`)) return resolve();
          if (Date.now() > deadline) return reject(new Error('Image probe did not report rendered content.'));
          setTimeout(poll, 25);
        };
        poll();
      });
      await Promise.race([
        frame.contentDocument!.fonts.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Image probe fonts did not finish loading.')), 5_000)),
      ]);
    };
    const expectContentFits = (frame: HTMLIFrameElement) => {
      const exported = frame.contentDocument!;
      const pre = exported.querySelector<HTMLElement>('#long-code')!;
      const table = exported.querySelector<HTMLTableElement>('#many-columns')!;
      const displayMath = exported.querySelector<HTMLElement>('.katex-display')!;
      expect(getComputedStyle(pre).overflow).toBe('visible');
      expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth);
      expect(exported.getElementById('long-url')!.scrollWidth).toBeLessThanOrEqual(exported.getElementById('long-url')!.clientWidth);
      expect(exported.getElementById('inline-code')!.scrollWidth).toBeLessThanOrEqual(exported.getElementById('inline-code')!.clientWidth);
      expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(exported.querySelector('.markda-export')!.clientWidth);
      expect([...table.querySelectorAll('th,td')].every((cell) => cell.scrollWidth <= cell.clientWidth)).toBe(true);
      expect(displayMath.scrollWidth).toBeLessThanOrEqual(displayMath.clientWidth);
    };
    try {
      await waitForImageProbe(probeFrame);
      expectContentFits(probeFrame);
      const probeDocument = probeFrame.contentDocument!.documentElement.cloneNode(true) as HTMLHtmlElement;
      const probeDom = `<!doctype html>\n${probeDocument.outerHTML}`;
      expect(parseProbedHeight(probeDom, nonce)).toBeGreaterThan(100);
      probeDocument.querySelectorAll('script').forEach((script) => script.remove());
      const captureHtml = `<!doctype html>\n${probeDocument.outerHTML}`;
      captureFrame = document.createElement('iframe');
      captureFrame.style.cssText = 'width:900px;height:1000px;border:0';
      captureFrame.srcdoc = captureHtml;
      document.body.append(captureFrame);
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 10_000;
        const poll = () => {
          if (captureFrame!.contentDocument?.querySelector('#long-code')) return resolve();
          if (Date.now() > deadline) return reject(new Error('Image capture document did not load.'));
          setTimeout(poll, 25);
        };
        poll();
      });
      await Promise.race([
        captureFrame.contentDocument!.fonts.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Image capture fonts did not finish loading.')), 5_000)),
      ]);
      expectContentFits(captureFrame);
      expect(captureFrame.contentDocument!.querySelectorAll('script')).toHaveLength(0);
    } finally {
      probeFrame.remove();
      captureFrame?.remove();
    }
  });

  it('renders Mermaid before capture under the export-only nonce policy', async () => {
    const nonce = 'trusted-export-test';
    const source = [
      'flowchart LR',
      '  Edit[Edit Markdown] --> Preview[Update preview]',
      '  Preview --> Save[Save file]',
    ].join('\n');
    const body = `<pre><code class="language-mermaid">${source}</code></pre><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="><img id="blocked-remote" src="https://blocked.invalid/pixel.png" alt="remote example">`
      + `<script>document.documentElement.dataset.markdaUnsafeScript='ran'</script>`;
    const policy = browserExportContentSecurityPolicy(false, nonce);
    const html = createHtmlDocument('Export smoke', body, 'en', '', '',
      policy,
      mermaidExportScript(exportMermaidBundle, nonce));
    const frame = document.createElement('iframe');
    frame.srcdoc = html;
    document.body.append(frame);
    try {
      await new Promise<void>((resolve, reject) => {
        frame.addEventListener('load', () => resolve(), { once: true });
        setTimeout(() => reject(new Error('Export iframe did not load.')), 20_000);
      });
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 20_000;
        const poll = () => {
          const root = frame.contentDocument?.documentElement;
          if (root?.dataset.markdaExportState === `${nonce}:ready`) return resolve();
          if (root?.dataset.markdaExportState === `${nonce}:error`) return reject(new Error(
            `Mermaid export renderer reported an error: ${root.dataset.markdaExportError ?? 'unknown error'}`,
          ));
          if (Date.now() > deadline) return reject(new Error('Mermaid export rendering timed out.'));
          setTimeout(poll, 50);
        };
        poll();
      });
      const exported = frame.contentDocument!;
      expect(exported.documentElement.dataset.markdaExportState).toBe(`${nonce}:ready`);
      expect(policy).toContain('img-src file: data:');
      expect(policy).not.toContain('https:');
      expect(exported.documentElement.dataset.markdaUnsafeScript).toBeUndefined();
      const diagram = exported.querySelector<HTMLElement>('pre')!;
      expect(diagram.querySelector('svg')).not.toBeNull();
      expect(diagram.querySelector('foreignObject')).toBeNull();
      expect(diagram.textContent).toContain('Edit Markdown');
      expect(diagram.textContent).toContain('Update preview');
      expect(diagram.textContent).toContain('Save file');
      expect(exported.images[0]!.complete).toBe(true);
      const blockedRemote = exported.querySelector<HTMLImageElement>('#blocked-remote')!;
      expect(blockedRemote.dataset.markdaRemoteBlocked).toBe('true');
      expect(blockedRemote.currentSrc).toMatch(/^data:image\/svg\+xml,/u);
      expect(await blockedRemote.decode().then(() => true, () => false)).toBe(true);
    } finally {
      frame.remove();
    }
  });
});
