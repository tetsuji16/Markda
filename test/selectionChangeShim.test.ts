// @vitest-environment happy-dom

import { afterEach, expect, it } from 'vitest';
import { deferSelectionChange } from './helpers/deferredSelectionChange';

let removeShim: (() => void) | undefined;

afterEach(() => {
  removeShim?.();
  removeShim = undefined;
});

it('delivers coalesced and subsequent selectionchange events through the same document', async () => {
  const nativeEvent = document.defaultView!.Event;
  const selection = document.getSelection()!;
  const text = document.createTextNode('abc');
  document.body.append(text);
  const observed: Array<[Node | null, number, Node | null, number]> = [];
  const listener = () => observed.push([
    selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset,
  ]);
  document.addEventListener('selectionchange', listener);
  removeShim = deferSelectionChange(document, window.setTimeout.bind(window));

  let otherEventWasSynchronous = false;
  document.addEventListener('markda-test-event', () => { otherEventWasSynchronous = true; });
  document.dispatchEvent(new nativeEvent('markda-test-event'));
  expect(otherEventWasSynchronous).toBe(true);

  selection.setBaseAndExtent(text, 0, text, 1);
  document.dispatchEvent(new nativeEvent('selectionchange'));
  selection.setBaseAndExtent(text, 1, text, 2);
  document.dispatchEvent(new nativeEvent('selectionchange'));
  expect(observed).toHaveLength(0);
  await new Promise((resolve) => window.setTimeout(resolve, 10));
  expect(observed).toEqual([[text, 1, text, 2]]);

  selection.setBaseAndExtent(text, 0, text, 0);
  document.dispatchEvent(new nativeEvent('selectionchange'));
  await new Promise((resolve) => window.setTimeout(resolve, 10));
  expect(observed).toEqual([[text, 1, text, 2], [text, 0, text, 0]]);
  document.removeEventListener('selectionchange', listener);
});
