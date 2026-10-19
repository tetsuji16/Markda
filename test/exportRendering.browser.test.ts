/// <reference types="@vitest/browser/providers/playwright" />
/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import exportMermaidBundle from '../dist/exportMermaid.js?raw';
import { browserExportContentSecurityPolicy, createHtmlDocument, mermaidExportScript } from '../src/htmlExport.js';

describe('browser-based document export rendering', () => {
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
