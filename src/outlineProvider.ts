import * as vscode from 'vscode';
import type { Heading } from './protocol.js';

export class OutlineProvider implements vscode.TreeDataProvider<HeadingItem> {
  private readonly changeEmitter = new vscode.EventEmitter<HeadingItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private roots: HeadingItem[] = [];
  private headings: readonly Heading[] = [];
  private cursor = 0;
  private filter = '';

  update(headings: readonly Heading[]): void {
    this.headings = headings;
    this.rebuild();
  }

  setCursor(cursor: number): void {
    const before = this.cursor;
    this.cursor = cursor;
    if (this.activeHeading(before)?.from !== this.activeHeading(cursor)?.from) this.rebuild();
  }

  setFilter(value: string): void {
    this.filter = value.trim().toLocaleLowerCase();
    this.rebuild();
  }

  getTreeItem(element: HeadingItem): vscode.TreeItem { return element; }
  getChildren(element?: HeadingItem): HeadingItem[] { return element?.children ?? this.roots; }

  private activeHeading(cursor: number): Heading | undefined {
    // Headings arrive in source order. Binary search avoids copying and
    // reversing the complete outline on every cursor movement.
    let low = 0;
    let high = this.headings.length - 1;
    let active: Heading | undefined;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const heading = this.headings[middle];
      if (heading && heading.from <= cursor) {
        active = heading;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return active;
  }

  private rebuild(): void {
    const active = this.activeHeading(this.cursor)?.from;
    const roots: HeadingItem[] = [];
    const stack: HeadingItem[] = [];
    for (const heading of this.headings) {
      if (this.filter && !heading.text.toLocaleLowerCase().includes(this.filter)) continue;
      const item = new HeadingItem(heading, heading.from === active);
      while (stack.length && (stack.at(-1)?.heading.level ?? 0) >= heading.level) stack.pop();
      const parent = stack.at(-1);
      if (parent) parent.children.push(item); else roots.push(item);
      stack.push(item);
    }
    for (const item of roots) item.refreshCollapsible();
    this.roots = roots;
    this.changeEmitter.fire(undefined);
  }
}

class HeadingItem extends vscode.TreeItem {
  readonly children: HeadingItem[] = [];
  constructor(readonly heading: Heading, active: boolean) {
    super(heading.text, vscode.TreeItemCollapsibleState.None);
    this.description = active ? `H${heading.level} · ${vscode.l10n.t('current')}` : `H${heading.level}`;
    this.command = { command: 'markda.focusHeading', title: vscode.l10n.t('Go to heading'), arguments: [heading] };
    this.iconPath = new vscode.ThemeIcon(active ? 'arrow-right' : 'symbol-namespace');
    this.contextValue = active ? 'markdaHeadingCurrent' : 'markdaHeading';
    this.accessibilityInformation = {
      label: vscode.l10n.t('{0}, heading level {1}{2}', heading.text, heading.level, active ? vscode.l10n.t(', current section') : ''),
    };
  }
  refreshCollapsible(): void {
    this.collapsibleState = this.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    for (const child of this.children) child.refreshCollapsible();
  }
}
