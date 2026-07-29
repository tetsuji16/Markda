/// <reference types="@vitest/browser/providers/playwright" />

import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentLineSeparator, normalizeDocumentText, serializeDocumentText,
} from '../src/webview/editorLogic.js';

import welcome from '../docs/showcase/01-welcome.md?raw';
import taskBoard from '../docs/showcase/02-task-board.md?raw';
import roadmap from '../docs/showcase/03-roadmap.md?raw';
import meetingNotes from '../docs/showcase/04-meeting-notes.md?raw';
import releaseNotes from '../docs/showcase/05-release-notes.md?raw';
import codeNotebook from '../docs/showcase/06-code-notebook.md?raw';
import dataSnapshot from '../docs/showcase/07-data-snapshot.md?raw';
import mathCanvas from '../docs/showcase/08-math-canvas.md?raw';
import ideaFlow from '../docs/showcase/09-idea-flow.md?raw';
import writingStudio from '../docs/showcase/10-writing-studio.md?raw';

const samples = [
  ['01-welcome.md', welcome],
  ['02-task-board.md', taskBoard],
  ['03-roadmap.md', roadmap],
  ['04-meeting-notes.md', meetingNotes],
  ['05-release-notes.md', releaseNotes],
  ['06-code-notebook.md', codeNotebook],
  ['07-data-snapshot.md', dataSnapshot],
  ['08-math-canvas.md', mathCanvas],
  ['09-idea-flow.md', ideaFlow],
  ['10-writing-studio.md', writingStudio],
] as const;

const settings = {
  contentWidth: 720,
  autoPairMarkdown: true,
  typewriterKeepCentered: true,
  previewUpdateDelay: 500,
  liveTableMaxCells: 600,
  themeMode: 'light' as const,
  markdown: { math: true, diagrams: true, html: false, breaks: false },
  theme: { light: 'paper', dark: 'midnight' },
  security: { allowRemoteResources: 'never' as const, allowUnsafeHtml: false },
};

async function settle(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function latestEdit(postMessage: ReturnType<typeof vi.fn>):
{ type: string; transactionId?: string; changes?: Array<{ from: number; to: number; insert: string }> } | undefined {
  return postMessage.mock.calls
    .map(([message]) => message as {
      type: string; transactionId?: string; changes?: Array<{ from: number; to: number; insert: string }>;
    })
    .reverse()
    .find((message) => message.type === 'edit');
}

function latestSave(postMessage: ReturnType<typeof vi.fn>):
{ type: string; expectedText?: string; text?: string } | undefined {
  return postMessage.mock.calls
    .map(([message]) => message as { type: string; expectedText?: string; text?: string })
    .reverse()
    .find((message) => message.type === 'save');
}

describe('showcase Markdown editing in Chromium', { timeout: 60_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial;
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('types, inserts a line break, saves, and undoes in all ten samples', async () => {
    const [firstName, firstText] = samples[0];
    const postMessage = vi.fn();
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: `file:///showcase/${firstName}`,
      resourceBaseUri: 'file:///showcase/',
      themeBaseUri: '',
      version: 1,
      text: firstText,
      settings,
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage,
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();

    for (const [index, [fileName, original]] of samples.entries()) {
      if (index > 0) {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'initialize',
            uri: `file:///showcase/${fileName}`,
            resourceBaseUri: 'file:///showcase/',
            themeBaseUri: '',
            version: 1,
            text: original,
            settings,
          },
        }));
        await settle();
      }
      postMessage.mockClear();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();

      const addition = '\n\nScreenshot check.';
      await userEvent.keyboard(addition);
      const normalizedOriginal = normalizeDocumentText(original);
      const serializedAddition = serializeDocumentText(addition, documentLineSeparator(original));
      expect(view.state.doc.toString(), fileName).toBe(`${normalizedOriginal}${addition}`);
      await vi.waitFor(() => expect(latestEdit(postMessage), fileName).toBeTruthy());

      const edit = latestEdit(postMessage);
      expect(edit?.transactionId, fileName).toBeTruthy();
      expect(edit?.changes?.[0]?.from, `${fileName} edit offset`).toBe(original.length);
      expect(edit?.changes?.[0]?.to, `${fileName} edit offset`).toBe(original.length);
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'documentChanged',
          version: 2,
          sourceTransactionId: edit?.transactionId,
        },
      }));

      await userEvent.keyboard('{Control>}s{/Control}');
      expect(latestSave(postMessage), fileName).toMatchObject({
        type: 'save',
        expectedText: `${original}${serializedAddition}`,
        text: `${original}${serializedAddition}`,
      });

      postMessage.mockClear();
      let previousText = view.state.doc.toString();
      for (let attempt = 0; attempt < addition.length + 2 && view.state.doc.toString() !== normalizedOriginal; attempt++) {
        await userEvent.keyboard('{Control>}z{/Control}');
        const undoneText = view.state.doc.toString();
        expect(undoneText.length, `${fileName} undo progress`).toBeLessThan(previousText.length);
        expect(normalizedOriginal.startsWith(undoneText) || undoneText.startsWith(normalizedOriginal), fileName).toBe(true);
        previousText = undoneText;
      }
      expect(view.state.doc.toString(), fileName).toBe(normalizedOriginal);
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'documentChanged',
          version: 3,
          text: original,
        },
      }));
    }
  });
});
