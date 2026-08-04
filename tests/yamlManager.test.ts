import { describe, it, expect, beforeEach } from 'vitest';
import { App, TFile, notices, resetNotices } from './stubs/obsidian';
import * as yaml from '../src/yamlManager';

function setup(content: string): { app: App; file: TFile } {
  const app = new App();
  const file = app.vault.create('Daily/2026-08-04.md', content);
  return { app, file };
}

beforeEach(resetNotices);

describe('malformed frontmatter', () => {
  // Regression: the writer used to fall back to an empty object on a parse
  // failure, rewriting the file and destroying every existing property.
  const MALFORMED = [
    '---',
    'title: "unclosed quote',
    'mood: 7',
    '---',
    'body text',
    '',
  ].join('\n');

  it('leaves the file byte-for-byte unchanged', async () => {
    const { app, file } = setup(MALFORMED);

    await expect(
      yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 })
    ).rejects.toThrow();

    expect(app.vault.raw(file.path)).toBe(MALFORMED);
  });

  it('tells the user why nothing was written', async () => {
    const { app, file } = setup(MALFORMED);

    await yaml.tryWrite(() =>
      yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 })
    );

    expect(notices.join('\n')).toMatch(/[Cc]ould not parse/);
  });

  it('reports failure to the caller rather than silently succeeding', async () => {
    const { app, file } = setup(MALFORMED);

    const ok = await yaml.tryWrite(() =>
      yaml.setProperties(app as never, file as never, { steps: 1000 })
    );

    expect(ok).toBe(false);
  });

  it('refuses to write when frontmatter is a list rather than a mapping', async () => {
    const original = '---\n- one\n- two\n---\nbody\n';
    const { app, file } = setup(original);

    await yaml.tryWrite(() =>
      yaml.setProperties(app as never, file as never, { steps: 1000 })
    );

    expect(app.vault.raw(file.path)).toBe(original);
  });
});

describe('frontmatter preservation on successful writes', () => {
  it('keeps unrelated properties intact', async () => {
    const { app, file } = setup('---\ntitle: Monday\nmood: 7\n---\nbody\n');

    await yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 });

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['title']).toBe('Monday');
    expect(fm['mood']).toBe(7);
    expect(fm['vitaminC']).toEqual([{ amount: 500 }]);
  });

  it('keeps the body intact', async () => {
    const { app, file } = setup('---\ntitle: Monday\n---\n# Heading\n\nSome notes.\n');

    await yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 });

    expect(app.vault.raw(file.path)).toContain('# Heading');
    expect(app.vault.raw(file.path)).toContain('Some notes.');
  });

  it('creates frontmatter for a file that has none', async () => {
    const { app, file } = setup('just a body\n');

    await yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 });

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['vitaminC']).toEqual([{ amount: 500 }]);
    expect(app.vault.raw(file.path)).toContain('just a body');
  });

  it('aborts rather than overwriting a scalar that should be a list', async () => {
    const original = '---\nvitaminC: 500\n---\nbody\n';
    const { app, file } = setup(original);

    const ok = await yaml.tryWrite(() =>
      yaml.appendEntry(app as never, file as never, 'vitaminC', { amount: 500 })
    );

    expect(ok).toBe(false);
    expect(app.vault.raw(file.path)).toBe(original);
    expect(notices.join('\n')).toMatch(/not a list/);
  });
});

describe('nested key renaming', () => {
  it('renames a top-level key, preserving its value', async () => {
    const { app, file } = setup('---\nmoodLog:\n  - time: "09:00"\n---\nbody\n');

    await yaml.renameTopLevelKey(app as never, file as never, 'moodLog', 'emotionLog');

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['moodLog']).toBeUndefined();
    expect(fm['emotionLog']).toEqual([{ time: '09:00' }]);
  });

  it('renames a key at a dot path without disturbing its siblings', async () => {
    const { app, file } = setup('---\nhealth:\n  bloodPressure: 120\n  pulse: 60\n---\nbody\n');

    await yaml.renameTopLevelKey(app as never, file as never, 'health.bloodPressure', 'health.bp');

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['health']).toEqual({ bp: 120, pulse: 60 });
  });

  it('renames a sub-key inside every entry of a list', async () => {
    const { app, file } = setup(
      '---\nmeditationLog:\n  - meditationTiming: 10\n  - meditationTiming: 20\n---\nbody\n'
    );

    await yaml.renameEntrySubKey(
      app as never, file as never, 'meditationLog', 'meditationTiming', 'minutes'
    );

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['meditationLog']).toEqual([{ minutes: 10 }, { minutes: 20 }]);
  });

  it('leaves a file alone when the old key is absent', async () => {
    const original = '---\ntitle: Monday\n---\nbody\n';
    const { app, file } = setup(original);

    await yaml.renameTopLevelKey(app as never, file as never, 'moodLog', 'emotionLog');

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm).toEqual({ title: 'Monday' });
  });
});

describe('mutateFrontmatter', () => {
  it('applies every staged change in a single write', async () => {
    const { app, file } = setup('---\ntitle: Monday\n---\nbody\n');

    await yaml.mutateFrontmatter(app as never, file as never, (fm, appendTo) => {
      appendTo('packs', { name: 'Morning' });
      appendTo('vitaminC', { amount: 500 });
      fm['steps'] = 1000;
    });

    const fm = await yaml.readAllFrontmatter(app as never, file as never);
    expect(fm['packs']).toEqual([{ name: 'Morning' }]);
    expect(fm['vitaminC']).toEqual([{ amount: 500 }]);
    expect(fm['steps']).toBe(1000);
    expect(fm['title']).toBe('Monday');
  });

  it('commits nothing when one staged change aborts', async () => {
    // vitaminC is a scalar, so appending to it must abort — and take the
    // already-staged packs entry down with it.
    const original = '---\nvitaminC: 500\n---\nbody\n';
    const { app, file } = setup(original);

    const ok = await yaml.tryWrite(() =>
      yaml.mutateFrontmatter(app as never, file as never, (_fm, appendTo) => {
        appendTo('packs', { name: 'Morning' });
        appendTo('vitaminC', { amount: 500 });
      })
    );

    expect(ok).toBe(false);
    expect(app.vault.raw(file.path)).toBe(original);
  });
});
