// ============================================================
// Vital Log — Command picker
// Uses Obsidian's native fuzzy-suggestion UI so custom-modal buttons can be
// configured by command name instead of requiring users to find a command ID.
// ============================================================

import { App, FuzzySuggestModal } from 'obsidian';
import type { Command } from 'obsidian';
import { getRegisteredCommands } from './internal';

export class CommandPickerModal extends FuzzySuggestModal<Command> {
  private readonly commands: Command[];
  private readonly onChoose: (command: Command) => void;

  constructor(app: App, onChoose: (command: Command) => void) {
    super(app);
    this.commands = getRegisteredCommands(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Search commands...');
  }

  getItems(): Command[] {
    return this.commands;
  }

  getItemText(command: Command): string {
    return command.name;
  }

  onChooseItem(command: Command): void {
    this.onChoose(command);
  }
}

/** Human-readable label for a saved command ID, including disabled commands. */
export function commandLabel(commands: Command[], commandId: string): string {
  if (!commandId) return '';
  return commands.find((command) => command.id === commandId)?.name ?? `${commandId} (unavailable)`;
}
