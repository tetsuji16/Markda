import { describe, expect, it } from 'vitest';
import {
  addTableColumn, addTableRow, alignTableColumn, deleteTableColumn, deleteTableRow,
  findMarkdownTable, serializeMarkdownTable, splitTableRow, tableCursor,
} from '../src/table.js';

const source = 'before\n\n| Name | Value |\n| :--- | ---: |\n| A | 1 |\n| B | 2 |\n\nafter';

describe('Markdown table model', () => {
  it('parses alignments and locates a table from a source offset', () => {
    const table = findMarkdownTable(source, source.indexOf('| A'))!;
    expect(table.header).toEqual(['Name', 'Value']);
    expect(table.alignments).toEqual(['left', 'right']);
    expect(table.rows).toEqual([['A', '1'], ['B', '2']]);
    expect(tableCursor(source, table, source.indexOf('1'))).toEqual({ row: 0, column: 1 });
  });

  it('handles escaped and code-span pipes', () => {
    expect(splitTableRow('| a\\|b | `x|y` | z |')).toEqual(['a\\|b', '`x|y`', 'z']);
  });

  it('adds, deletes and aligns rows and columns', () => {
    let table = findMarkdownTable(source, source.indexOf('| A'))!;
    table = addTableRow(table, 1);
    table = addTableColumn(table, 1);
    table = alignTableColumn(table, 1, 'center');
    expect(table.rows).toHaveLength(3);
    expect(table.header).toHaveLength(3);
    expect(table.alignments[1]).toBe('center');
    table = deleteTableRow(table, 1);
    table = deleteTableColumn(table, 1);
    expect(table.rows).toHaveLength(2);
    expect(table.header).toHaveLength(2);
  });

  it('serializes a valid stable-width table', () => {
    const table = findMarkdownTable(source, source.indexOf('| A'))!;
    const output = serializeMarkdownTable(table);
    expect(output).toContain('| Name | Value |');
    expect(output).toContain('| :--- | ----: |');
    expect(findMarkdownTable(output, output.indexOf('| A'))?.rows).toEqual(table.rows);
  });

  it('finds a local table without depending on uniform line endings', () => {
    const mixed = `prefix\r\ntext\r| H | V |\r\n| --- | --- |\n| a | b |\r\nsuffix`;
    const table = findMarkdownTable(mixed, mixed.indexOf('| a'))!;
    expect(table.header).toEqual(['H', 'V']);
    expect(table.rows).toEqual([['a', 'b']]);
    expect(mixed.slice(table.from, table.to)).toContain('| a | b |');
  });

  it('locates a table inside a large document', () => {
    const prefix = 'ordinary prose\n'.repeat(20_000);
    const large = `${prefix}| H |\n| --- |\n| value |\nend`;
    const table = findMarkdownTable(large, prefix.length + 5)!;
    expect(table.startLine).toBe(20_000);
    expect(table.rows[0]).toEqual(['value']);
  });

  it('finds every table in a long LF document without rescanning the document per table', () => {
    // Live decorations look up each table in turn. Each lookup must cost the
    // size of the table, not of the text before it (no '\r' in an LF file once
    // made every lookup walk back to the start of the document).
    const block = '## Heading\n\nProse line.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n';
    const large = block.repeat(20_000);
    const offsets: number[] = [];
    for (let at = large.indexOf('| A'); at >= 0; at = large.indexOf('| A', at + 1)) offsets.push(at);
    expect(offsets).toHaveLength(20_000);
    const started = performance.now();
    for (const [index, offset] of offsets.entries()) {
      const table = findMarkdownTable(large, offset, index * 8 + 4)!;
      expect(table.from).toBe(offset);
    }
    // Linear lookups take about 0.1s here; the quadratic scan took over 10s.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('finds the line around an offset at LF, CRLF, and CR boundaries', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const text = ['intro', '| A | B |', '| --- | --- |', '| 1 | 2 |', 'outro'].join(eol);
      const start = text.indexOf('| A');
      for (const offset of [start, start + 3, text.indexOf('| 1') + 1]) {
        const table = findMarkdownTable(text, offset, 1)!;
        expect(table.from).toBe(start);
        expect(table.rows).toEqual([['1', '2']]);
      }
    }
  });
});
