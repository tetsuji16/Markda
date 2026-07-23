/// <reference types="@vitest/browser/providers/playwright" />

import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
{ type: string; transactionId?: string } | undefined {
  return postMessage.mock.calls
    .map(([message]) => message as { type: string; transactionId?: string })
    .reverse()
    .find((message) => message.type === 'edit');
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
      expect(view.state.doc.toString(), fileName).toBe(`${original}${addition}`);
      await vi.waitFor(() => expect(latestEdit(postMessage), fileName).toBeTruthy());

      const edit = latestEdit(postMessage);
      expect(edit?.transactionId, fileName).toBeTruthy();
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'documentChanged',
          version: 2,
          sourceTransactionId: edit?.transactionId,
        },
      }));

      await userEvent.keyboard('{Control>}s{/Control}');
      expect(postMessage.mock.calls.at(-1)?.[0], fileName).toMatchObject({
        type: 'save',
        expectedText: `${original}${addition}`,
        text: `${original}${addition}`,
      });

      postMessage.mockClear();
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(view.state.doc.toString(), fileName).toBe(`${original}\n`);

      await userEvent.keyboard('{Control>}z{/Control}');
      expect(view.state.doc.toString(), fileName).toBe(original);
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
