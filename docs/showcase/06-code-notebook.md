# { } Code Notebook

A tiny TypeScript function with a visible result.

```ts
type Note = {
  title: string;
  done: boolean;
};

const summarize = (note: Note) => {
  const marker = note.done ? "✓" : "○";
  return marker + " " + note.title;
};

console.log(summarize({ title: "Try Markda", done: true }));
```

**Output**

```text
✓ Try Markda
```

> Code stays editable without losing its Markdown fence.
