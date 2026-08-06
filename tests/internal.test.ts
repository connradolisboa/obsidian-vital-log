import { describe, expect, it } from 'vitest';
import type { App, Command } from 'obsidian';
import { getRegisteredCommands } from '../src/internal';

function appWithCommands(commands: unknown): App {
  return { commands } as unknown as App;
}

describe('getRegisteredCommands', () => {
  it('uses the same command list exposed to Obsidian command-palette consumers', () => {
    const expected = [
      { id: 'daily-notes:open', name: 'Open today’s daily note' },
      { id: 'editor:toggle-bold', name: 'Toggle bold' },
    ] as Command[];
    const app = appWithCommands({ listCommands: () => expected });

    expect(getRegisteredCommands(app)).toEqual(expected);
  });

  it('falls back to the command registry and removes invalid or duplicate entries', () => {
    const app = appWithCommands({
      commands: {
        first: { id: 'plugin:action', name: 'Plugin action' },
        duplicate: { id: 'plugin:action', name: 'Duplicate' },
        invalid: { id: 'missing-name' },
      },
    });

    expect(getRegisteredCommands(app)).toEqual([
      { id: 'plugin:action', name: 'Plugin action' },
    ]);
  });
});
