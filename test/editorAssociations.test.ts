import { describe, expect, it } from 'vitest';
import {
  applyMarkdaAssociations,
  defaultTextEditorViewType,
  markdaViewType,
  opensWithMarkda,
} from '../src/editorAssociations.js';

describe('editor associations', () => {
  it('treats an unconfigured supported pattern as Markda because its priority is default', () => {
    expect(opensWithMarkda({}, '*.md')).toBe(true);
    expect(opensWithMarkda({ '*.md': markdaViewType }, '*.md')).toBe(true);
    expect(opensWithMarkda({ '*.md': defaultTextEditorViewType }, '*.md')).toBe(false);
  });

  it('writes Markda and text-editor defaults for the selected file types', () => {
    const updated = applyMarkdaAssociations({}, new Set(['*.md', '*.markdown']));

    expect(updated['*.md']).toBe(markdaViewType);
    expect(updated['*.markdown']).toBe(markdaViewType);
    expect(updated['*.txt']).toBe(defaultTextEditorViewType);
  });

  it('preserves associations owned by another custom editor', () => {
    const updated = applyMarkdaAssociations(
      { '*.md': 'another.markdownEditor', '*.txt': markdaViewType, '*.json': 'json.editor' },
      new Set<string>(),
    );

    expect(updated['*.md']).toBe('another.markdownEditor');
    expect(updated['*.txt']).toBe(defaultTextEditorViewType);
    expect(updated['*.json']).toBe('json.editor');
  });
});
