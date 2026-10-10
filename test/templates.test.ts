import { describe, expect, it } from 'vitest';
import {
  builtInTemplates, getDocumentTemplates, renderTemplate, validateCustomTemplates,
} from '../src/templates.js';

describe('document templates', () => {
  it('provides the three useful built-in templates with title and date placeholders', () => {
    expect(builtInTemplates.map(({ id }) => id)).toEqual(['meeting', 'spec', 'daily']);
    for (const template of builtInTemplates) {
      expect(template.body).toContain('{{title}}');
      expect(template.body).toContain('{{date}}');
    }
  });

  it('renders repeated supported placeholders and preserves unknown placeholders', () => {
    expect(renderTemplate('# {{title}}\n{{date}} / {{title}} / {{author}}', {
      title: 'Sprint review', date: '2026-10-10',
    })).toBe('# Sprint review\n2026-10-10 / Sprint review / {{author}}');
  });

  it('accepts bounded custom templates, skips invalid values, and gives duplicate names unique ids', () => {
    const templates = validateCustomTemplates([
      { name: 'Team Notes', description: 'A short note.', body: '# {{title}}' },
      { name: 'Team Notes', description: '', body: '## Follow up' },
      { name: '', description: '', body: 'bad' },
      { name: 'Too long', description: '', body: 'x'.repeat(50_001) },
      null,
    ]);
    expect(templates).toEqual([
      { id: 'custom-team-notes', name: 'Team Notes', description: 'A short note.', body: '# {{title}}' },
      { id: 'custom-team-notes-1', name: 'Team Notes', description: '', body: '## Follow up' },
    ]);
  });

  it('combines built-ins with validated custom templates and rejects non-array settings', () => {
    expect(getDocumentTemplates({ name: 'not an array' })).toHaveLength(3);
    expect(getDocumentTemplates([{ name: 'Research', description: '', body: '## Findings' }]).map(({ id }) => id))
      .toEqual(['meeting', 'spec', 'daily', 'custom-research']);
  });
});
