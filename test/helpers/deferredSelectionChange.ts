export function deferSelectionChange(document: Document, schedule: typeof window.setTimeout): () => void {
  const getSnapshot = () => {
    const selection = document.getSelection();
    return selection && {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
    };
  };
  let lastNotified = getSnapshot();
  let scheduled = false;
  let dispatching = false;

  const handleSelectionChange = (event: Event) => {
    if (dispatching) return;
    // Happy DOM emits synchronously when it associates a Range. Stop this
    // delivery, then reproduce the browser's queued, coalesced notification.
    event.stopImmediatePropagation();
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const latest = getSnapshot();
      const unchanged = latest === null && lastNotified === null
        || latest !== null && lastNotified !== null
          && latest.anchorNode === lastNotified.anchorNode
          && latest.anchorOffset === lastNotified.anchorOffset
          && latest.focusNode === lastNotified.focusNode
          && latest.focusOffset === lastNotified.focusOffset;
      if (unchanged) return;
      lastNotified = latest;
      dispatching = true;
      try {
        const EventConstructor = document.defaultView?.Event ?? Event;
        document.dispatchEvent(new EventConstructor('selectionchange'));
      } finally {
        dispatching = false;
      }
    }, 0);
  };
  document.addEventListener('selectionchange', handleSelectionChange, true);
  return () => document.removeEventListener('selectionchange', handleSelectionChange, true);
}
