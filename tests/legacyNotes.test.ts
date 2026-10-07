import { describe, it, expect } from 'vitest';
import { App } from './stubs/obsidian';
import {
  findLegacyNote,
  getNoteIfExists,
  noteDateForTemplate,
  resolveNote,
  templateRoot,
} from '../src/dailyNoteResolver';

const TEMPLATE = 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}';
const feb15 = new Date(2025, 1, 15, 12);

function vault(): App {
  const app = new App();
  app.vault.create('Calendar/Daily/2025/2025-02-15 Saturday.md', '---\n---\n');
  app.vault.create('Calendar/Daily/2026/Q4/2026-10-07 Wednesday.md', '---\n---\n');
  app.vault.create('Projects/2025-02-15 kickoff.md', '');
  return app;
}

describe('templateRoot', () => {
  it('is the folder before the first token', () => {
    expect(templateRoot(TEMPLATE)).toBe('Calendar/Daily/');
    expect(templateRoot('{{YYYY-MM-DD}}')).toBe('');
  });
});

describe('noteDateForTemplate', () => {
  it('reads exact template matches', () => {
    expect(noteDateForTemplate('Calendar/Daily/2026/Q4/2026-10-07 Wednesday.md', TEMPLATE)?.toDateString())
      .toBe(new Date(2026, 9, 7).toDateString());
  });

  it('reads notes filed under an older layout inside the root folder', () => {
    expect(noteDateForTemplate('Calendar/Daily/2025/2025-02-15 Saturday.md', TEMPLATE)?.toDateString())
      .toBe(feb15.toDateString());
  });

  it('ignores dated notes outside the root folder, and undated ones inside it', () => {
    expect(noteDateForTemplate('Projects/2025-02-15 kickoff.md', TEMPLATE)).toBeNull();
    expect(noteDateForTemplate('Calendar/Daily/Index.md', TEMPLATE)).toBeNull();
  });
});

describe('legacy lookup', () => {
  it('finds a day filed under the old layout', () => {
    const app = vault();
    expect(findLegacyNote(app as never, TEMPLATE, feb15)?.path).toBe('Calendar/Daily/2025/2025-02-15 Saturday.md');
    expect(getNoteIfExists(app as never, TEMPLATE, feb15)?.path).toBe('Calendar/Daily/2025/2025-02-15 Saturday.md');
  });

  it('does not treat notes outside the root as daily notes', () => {
    const app = new App();
    app.vault.create('Projects/2025-02-15 kickoff.md', '');
    expect(findLegacyNote(app as never, TEMPLATE, feb15)).toBeNull();
  });

  it('logs into the old-layout note instead of creating a duplicate', async () => {
    const app = vault();
    const file = await resolveNote(app as never, TEMPLATE, feb15);
    expect(file?.path).toBe('Calendar/Daily/2025/2025-02-15 Saturday.md');
    expect(app.vault.getMarkdownFiles().map((f) => f.path)).not.toContain('Calendar/Daily/2025/Q1/2025-02-15 Saturday.md');
  });
});
