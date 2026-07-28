import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Keybinding {
  command: string;
  when?: string;
}

interface Manifest {
  contributes: {
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
    keybindings: Keybinding[];
  };
}

describe('contributed keybindings', () => {
  it('leaves VS Code shortcuts enabled unless the user opts in', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as Manifest;
    const setting = 'markda.editor.enableDefaultKeybindings';

    expect(manifest.contributes.configuration.properties[setting]?.default).toBe(false);
    expect(manifest.contributes.keybindings.length).toBeGreaterThan(0);
    for (const binding of manifest.contributes.keybindings) {
      expect(binding.when, binding.command).toContain(`config.${setting}`);
    }
  });
});
