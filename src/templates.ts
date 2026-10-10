export interface DocumentTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export interface TemplateVariables {
  readonly title: string;
  readonly date: string;
}

export const builtInTemplates: readonly DocumentTemplate[] = [
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Capture decisions, discussion, and follow-up actions.',
    body: '# {{title}}\n\n**Date:** {{date}}\n**Attendees:**\n\n## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
  },
  {
    id: 'spec',
    name: 'Project spec',
    description: 'Outline a problem, proposed approach, and success measures.',
    body: '# {{title}}\n\n**Date:** {{date}}\n\n## Summary\n\n\n## Problem\n\n\n## Goals\n\n- \n\n## Non-goals\n\n- \n\n## Proposed approach\n\n\n## Success measures\n\n- \n\n## Open questions\n\n- \n',
  },
  {
    id: 'daily',
    name: 'Daily journal',
    description: 'Plan the day and record progress and reflections.',
    body: '# {{title}}\n\n**Date:** {{date}}\n\n## Today\n\n- [ ] \n\n## Notes\n\n\n## Reflection\n\n- What went well?\n- What could be better?\n',
  },
];

const maximumCustomTemplates = 50;

/** Returns well-formed user templates from a settings value, skipping invalid entries. */
export function validateCustomTemplates(value: unknown): readonly DocumentTemplate[] {
  if (!Array.isArray(value)) return [];
  const templates: DocumentTemplate[] = [];
  const ids = new Set(builtInTemplates.map((template) => template.id));
  for (const item of value) {
    if (templates.length >= maximumCustomTemplates || !isRecord(item)) continue;
    const name = item.name;
    const description = item.description;
    const body = item.body;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80
      || typeof description !== 'string' || description.length > 240
      || typeof body !== 'string' || !body.trim() || body.length > 50_000) continue;
    const baseId = `custom-${slug(name)}`;
    let id = baseId;
    let suffix = 1;
    while (ids.has(id)) id = `${baseId}-${suffix++}`;
    ids.add(id);
    templates.push({ id, name: name.trim(), description: description.trim(), body });
  }
  return templates;
}

/** Combines built-in templates with validated settings-provided templates. */
export function getDocumentTemplates(custom: unknown): readonly DocumentTemplate[] {
  return [...builtInTemplates, ...validateCustomTemplates(custom)];
}

/** Replaces the supported placeholders while leaving unknown placeholders intact. */
export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body.replace(/\{\{(title|date)\}\}/gu, (_match, key: 'title' | 'date') => variables[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '') || 'template';
}
