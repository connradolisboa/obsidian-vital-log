// ============================================================
// Vital Log — Obsidian internal-API access
// Obsidian doesn't publicly type its command registry or the plugin list,
// so the few places we need them are funnelled through here. Keeping every
// `any` cast in one guarded module means a future Obsidian change is a
// one-file fix instead of a hunt across the codebase.
// ============================================================

import type { App, Command, TFile } from 'obsidian';

/** The slice of Templater's plugin API that we use. */
export interface TemplaterPlugin {
  templater?: {
    overwrite_file_commands?: (file: TFile) => Promise<void>;
    write_template_to_file?: (template: TFile, file: TFile) => Promise<void>;
  };
}

interface CommandRegistry {
  commands?: Record<string, Command>;
  listCommands?: () => Command[];
  executeCommandById?: (id: string) => void;
}

interface PluginRegistry {
  plugins?: Record<string, unknown>;
}

interface InternalApp {
  commands?: CommandRegistry;
  plugins?: PluginRegistry;
}

function asInternal(app: App): InternalApp {
  return app as unknown as InternalApp;
}

/**
 * Remove a command from Obsidian's registry by full id (`pluginId:commandId`).
 * Obsidian has no public removeCommand API, so we delete from the registry.
 * No-ops if the command isn't registered.
 */
export function removeCommand(app: App, fullId: string): void {
  const commands = asInternal(app).commands?.commands;
  if (commands && fullId in commands) {
    delete commands[fullId];
  }
}

/** Run a registered command by id. No-ops if the command API is unavailable. */
export function executeCommandById(app: App, id: string): void {
  asInternal(app).commands?.executeCommandById?.(id);
}

/** Return every command currently available to Obsidian's command palette. */
export function getRegisteredCommands(app: App): Command[] {
  const registry = asInternal(app).commands;
  const commands = registry?.listCommands?.() ?? Object.values(registry?.commands ?? {});
  const seen = new Set<string>();

  return commands.filter((command): command is Command => {
    if (!command || typeof command.id !== 'string' || typeof command.name !== 'string') return false;
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

/** The Templater plugin instance, or null if it isn't installed/enabled. */
export function getTemplaterPlugin(app: App): TemplaterPlugin | null {
  return (asInternal(app).plugins?.plugins?.['templater-obsidian'] as TemplaterPlugin) ?? null;
}
