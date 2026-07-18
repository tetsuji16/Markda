export type TableAlignment = 'default' | 'left' | 'center' | 'right';

export interface MarkdownTable {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  header: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

export function findMarkdownTable(source: string, offset: number, activeLineNumber?: number): MarkdownTable | undefined {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let active = lineAt(source, safeOffset);
  if (!isTableLine(active.text)) return undefined;
  const tableLines = [active];
  let linesBeforeActive = 0;
  let previous = previousLine(source, active.from);
  while (previous && isTableLine(previous.text)) {
    tableLines.unshift(previous);
    linesBeforeActive++;
    previous = previousLine(source, previous.from);
  }
  let next = nextLine(source, active.to);
  while (next && isTableLine(next.text)) {
    tableLines.push(next);
    next = nextLine(source, next.to);
  }
  if (tableLines.length < 2) return undefined;

  let separatorLine = -1;
  for (let index = 1; index < tableLines.length; index++) {
    const cells = splitTableRow(tableLines[index]?.text ?? '');
    if (cells.length > 0 && cells.every(isSeparatorCell)) {
      separatorLine = index;
      break;
    }
  }
  if (separatorLine !== 1) return undefined;
  const header = splitTableRow(tableLines[0]?.text ?? '');
  const separator = splitTableRow(tableLines[separatorLine]?.text ?? '');
  const columnCount = Math.max(header.length, separator.length);
  if (columnCount === 0) return undefined;
  const rows = tableLines.slice(separatorLine + 1).map((line) => normalizeRow(splitTableRow(line.text), columnCount));
  const from = tableLines[0]?.from ?? 0;
  const to = tableLines.at(-1)?.to ?? from;
  const startLine = activeLineNumber === undefined ? countLinesBefore(source, from) : activeLineNumber - linesBeforeActive;
  const endLine = startLine + tableLines.length - 1;
  return {
    from,
    to,
    startLine,
    endLine,
    header: normalizeRow(header, columnCount),
    alignments: normalizeAlignments(separator.map(parseAlignment), columnCount),
    rows,
  };
}

interface SourceLine { from: number; to: number; text: string }

function lineAt(source: string, offset: number): SourceLine {
  const searchBefore = offset > 0 ? offset - 1 : -1;
  const previousLf = searchBefore < 0 ? -1 : source.lastIndexOf('\n', searchBefore);
  const previousCr = searchBefore < 0 ? -1 : source.lastIndexOf('\r', searchBefore);
  const from = Math.max(previousLf, previousCr) + 1;
  let to = from;
  while (to < source.length && source[to] !== '\r' && source[to] !== '\n') to++;
  return { from, to, text: source.slice(from, to) };
}

function previousLine(source: string, from: number): SourceLine | undefined {
  if (from <= 0) return undefined;
  let end = from - 1;
  if (source[end] === '\n' && end > 0 && source[end - 1] === '\r') end--;
  return lineAt(source, Math.max(0, end));
}

function nextLine(source: string, to: number): SourceLine | undefined {
  if (to >= source.length) return undefined;
  const from = to + (source[to] === '\r' && source[to + 1] === '\n' ? 2 : 1);
  return from <= source.length ? lineAt(source, from) : undefined;
}

function countLinesBefore(source: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === '\n' || (source[index] === '\r' && source[index + 1] !== '\n')) line++;
  }
  return line;
}

export function serializeMarkdownTable(table: MarkdownTable, eol = '\n'): string {
  const widths = table.header.map((cell, column) => {
    const contentWidth = Math.max(cell.length, ...table.rows.map((row) => row[column]?.length ?? 0));
    return Math.max(3, contentWidth);
  });
  const renderRow = (cells: readonly string[]) => `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(' | ')} |`;
  const separators = table.alignments.map((alignment, index) => renderSeparator(alignment, widths[index] ?? 3));
  return [renderRow(table.header), renderRow(separators), ...table.rows.map(renderRow)].join(eol);
}

export function addTableRow(table: MarkdownTable, index: number): MarkdownTable {
  const rows = [...table.rows];
  rows.splice(clamp(index, 0, rows.length), 0, Array.from({ length: table.header.length }, () => ''));
  return { ...table, rows };
}

export function deleteTableRow(table: MarkdownTable, index: number): MarkdownTable {
  if (index < 0 || index >= table.rows.length) return table;
  return { ...table, rows: table.rows.filter((_row, rowIndex) => rowIndex !== index) };
}

export function addTableColumn(table: MarkdownTable, index: number): MarkdownTable {
  const target = clamp(index, 0, table.header.length);
  const insert = (row: readonly string[]) => [...row.slice(0, target), '', ...row.slice(target)];
  return {
    ...table,
    header: insert(table.header),
    alignments: [...table.alignments.slice(0, target), 'default', ...table.alignments.slice(target)],
    rows: table.rows.map(insert),
  };
}

export function deleteTableColumn(table: MarkdownTable, index: number): MarkdownTable {
  if (table.header.length <= 1 || index < 0 || index >= table.header.length) return table;
  const remove = <T>(row: readonly T[]) => row.filter((_cell, column) => column !== index);
  return { ...table, header: remove(table.header), alignments: remove(table.alignments), rows: table.rows.map(remove) };
}

export function alignTableColumn(table: MarkdownTable, index: number, alignment: TableAlignment): MarkdownTable {
  if (index < 0 || index >= table.alignments.length) return table;
  return { ...table, alignments: table.alignments.map((value, column) => column === index ? alignment : value) };
}

export function tableCursor(source: string, table: MarkdownTable, offset: number): { row: number; column: number } {
  const before = source.slice(table.from, Math.max(table.from, Math.min(offset, table.to)));
  const lines = before.split(/\r\n|\r|\n/u);
  const line = lines.at(-1) ?? '';
  const absoluteLine = table.startLine + lines.length - 1;
  const row = absoluteLine === table.startLine ? -1 : absoluteLine - table.startLine - 2;
  return { row, column: columnAt(line) };
}

export function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let codeFence = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index] ?? '';
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      cell += character;
      escaped = true;
    } else if (character === '`') {
      codeFence = codeFence === 0 ? 1 : 0;
      cell += character;
    } else if (character === '|' && codeFence === 0) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function columnAt(line: string): number {
  let column = line.trimStart().startsWith('|') ? -1 : 0;
  let escaped = false;
  let code = false;
  for (const character of line) {
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '`') code = !code;
    else if (character === '|' && !code) column++;
  }
  return Math.max(0, column);
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  const cells = splitTableRow(line);
  return trimmed.length > 0 && (cells.length > 1 || (cells.length === 1 && trimmed.startsWith('|') && trimmed.endsWith('|')));
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{1,}:?$/u.test(cell.trim());
}

function parseAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
  if (trimmed.endsWith(':')) return 'right';
  if (trimmed.startsWith(':')) return 'left';
  return 'default';
}

function renderSeparator(alignment: TableAlignment, width: number): string {
  if (alignment === 'center') return `:${'-'.repeat(Math.max(1, width - 2))}:`;
  if (alignment === 'left') return `:${'-'.repeat(Math.max(2, width - 1))}`;
  if (alignment === 'right') return `${'-'.repeat(Math.max(2, width - 1))}:`;
  return '-'.repeat(width);
}

function normalizeRow(row: readonly string[], length: number): string[] {
  return Array.from({ length }, (_value, index) => row[index] ?? '');
}

function normalizeAlignments(row: readonly TableAlignment[], length: number): TableAlignment[] {
  return Array.from({ length }, (_value, index) => row[index] ?? 'default');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
