import { describe, it, expect, beforeEach } from 'vitest';
import { App, TFile, notices, resetNotices } from './stubs/obsidian';
import { logVitamin, logPack, logStack } from '../src/vitaminManager';
import * as yaml from '../src/yamlManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings, Vitamin, Pack, Stack } from '../src/types';

const vitaminC: Vitamin = {
  id: 'v1', displayName: 'Vitamin C', propertyKey: 'vitaminC', defaultAmount: 500, unit: 'mg',
};
const vitaminD: Vitamin = {
  id: 'v2', displayName: 'Vitamin D', propertyKey: 'vitaminD', defaultAmount: 1000, unit: 'IU',
};
const morningPack: Pack = {
  id: 'p1',
  displayName: 'Morning Pack',
  items: [{ vitaminId: 'v1', amount: 500 }, { vitaminId: 'v2', amount: 1000 }],
};
const morningStack: Stack = {
  id: 's1',
  displayName: 'Morning Stack',
  schedulingHint: 'Morning',
  items: [{ type: 'pack', packId: 'p1' }, { type: 'vitamin', vitaminId: 'v2' }],
};

function settings(overrides: Partial<VitalLogSettings> = {}): VitalLogSettings {
  return {
    ...DEFAULT_SETTINGS,
    vitamins: [vitaminC, vitaminD],
    packs: [morningPack],
    stacks: [morningStack],
    ...overrides,
  };
}

function setup(content = '---\ntitle: Monday\n---\nbody\n'): { app: App; file: TFile } {
  const app = new App();
  return { app, file: app.vault.create('Daily/2026-08-04.md', content) };
}

async function fm(app: App, file: TFile): Promise<Record<string, unknown>> {
  return yaml.readAllFrontmatter(app as never, file as never);
}

beforeEach(resetNotices);

describe('logVitamin', () => {
  it('writes an entry under the vitamin property key', async () => {
    const { app, file } = setup();

    await logVitamin(app as never, file as never, vitaminC, { time: '09:00', amount: 500 }, settings());

    expect(await fm(app, file)).toMatchObject({
      vitaminC: [{ time: '09:00', amount: 500, unit: 'mg', source: 'manual' }],
    });
  });

  it('routes into substances[] in substances mode', async () => {
    const { app, file } = setup();

    await logVitamin(
      app as never, file as never, vitaminC,
      { time: '09:00', amount: 500 },
      settings({ logMode: 'substances' })
    );

    const result = await fm(app, file);
    expect(result['vitaminC']).toBeUndefined();
    expect(result['substances']).toEqual([
      { name: 'Vitamin C', amount: 500, unit: 'mg', time: '09:00' },
    ]);
  });

  it('omits source when logSource is off', async () => {
    const { app, file } = setup();

    await logVitamin(
      app as never, file as never, vitaminC,
      { time: '09:00', amount: 500 },
      settings({ logSource: false })
    );

    expect((await fm(app, file))['vitaminC']).toEqual([
      { time: '09:00', amount: 500, unit: 'mg' },
    ]);
  });
});

describe('logPack', () => {
  it('writes the pack entry and every vitamin it contains', async () => {
    const { app, file } = setup();

    await logPack(app as never, file as never, morningPack, settings(), { time: '09:00' });

    const result = await fm(app, file);
    expect(result['packs']).toEqual([
      { time: '09:00', name: 'Morning Pack', source: 'manual' },
    ]);
    expect(result['vitaminC']).toEqual([
      { time: '09:00', amount: 500, unit: 'mg', source: 'Morning Pack' },
    ]);
    expect(result['vitaminD']).toEqual([
      { time: '09:00', amount: 1000, unit: 'IU', source: 'Morning Pack' },
    ]);
  });

  // Regression: the pack used to be written one entry at a time, so a failure
  // part-way through left the note holding a partial log.
  it('commits the whole pack in a single write', async () => {
    const { app, file } = setup();
    let writes = 0;
    const originalProcess = app.vault.process.bind(app.vault);
    app.vault.process = async (f, fn) => { writes += 1; return originalProcess(f, fn); };

    await logPack(app as never, file as never, morningPack, settings(), { time: '09:00' });

    expect(writes).toBe(1);
  });

  it('records nothing at all when one entry aborts', async () => {
    // vitaminD is a scalar here, so its append must abort — and the pack entry
    // plus vitaminC staged alongside it must not survive either.
    const original = '---\nvitaminD: 1000\n---\nbody\n';
    const { app, file } = setup(original);

    const ok = await yaml.tryWrite(() =>
      logPack(app as never, file as never, morningPack, settings(), { time: '09:00' })
    );

    expect(ok).toBe(false);
    expect(app.vault.raw(file.path)).toBe(original);
  });

  it('skips unknown vitamin IDs and says so, still logging the rest', async () => {
    const { app, file } = setup();
    const packWithGhost: Pack = {
      ...morningPack,
      items: [{ vitaminId: 'v1', amount: 500 }, { vitaminId: 'gone', amount: 1 }],
    };

    await logPack(app as never, file as never, packWithGhost, settings(), { time: '09:00' });

    const result = await fm(app, file);
    expect(result['vitaminC']).toHaveLength(1);
    expect(notices.join('\n')).toMatch(/unknown vitamin IDs: gone/);
  });

  it('omits the packs[] entry when logPackEntries is off', async () => {
    const { app, file } = setup();

    await logPack(
      app as never, file as never, morningPack,
      settings({ logPackEntries: false }),
      { time: '09:00' }
    );

    const result = await fm(app, file);
    expect(result['packs']).toBeUndefined();
    expect(result['vitaminC']).toHaveLength(1);
  });
});

describe('logStack', () => {
  it('writes the stack entry, nested pack contents, and standalone vitamins', async () => {
    const { app, file } = setup();

    await logStack(app as never, file as never, morningStack, settings(), { time: '07:00' });

    const result = await fm(app, file);
    expect(result['stacks']).toEqual([{ time: '07:00', name: 'Morning Stack' }]);
    expect(result['packs']).toEqual([
      { time: '07:00', name: 'Morning Pack', source: 'Morning Stack' },
    ]);
    // Vitamin D appears twice: once via the pack, once standalone.
    expect(result['vitaminD']).toHaveLength(2);
    expect(result['vitaminC']).toHaveLength(1);
  });

  it('commits the whole stack in a single write', async () => {
    const { app, file } = setup();
    let writes = 0;
    const originalProcess = app.vault.process.bind(app.vault);
    app.vault.process = async (f, fn) => { writes += 1; return originalProcess(f, fn); };

    await logStack(app as never, file as never, morningStack, settings(), { time: '07:00' });

    expect(writes).toBe(1);
  });

  it('uses a standalone vitamin default amount when none is given', async () => {
    const { app, file } = setup();
    const stack: Stack = {
      ...morningStack,
      items: [{ type: 'vitamin', vitaminId: 'v1' }],
    };

    await logStack(app as never, file as never, stack, settings(), { time: '07:00' });

    expect((await fm(app, file))['vitaminC']).toEqual([
      { time: '07:00', amount: 500, unit: 'mg', source: 'Morning Stack' },
    ]);
  });

  it('skips unknown references and says so', async () => {
    const { app, file } = setup();
    const stack: Stack = {
      ...morningStack,
      items: [{ type: 'pack', packId: 'gone' }, { type: 'vitamin', vitaminId: 'v1' }],
    };

    await logStack(app as never, file as never, stack, settings(), { time: '07:00' });

    expect((await fm(app, file))['vitaminC']).toHaveLength(1);
    expect(notices.join('\n')).toMatch(/pack:gone/);
  });

  it('preserves unrelated frontmatter', async () => {
    const { app, file } = setup('---\ntitle: Monday\nmood: 7\n---\nbody\n');

    await logStack(app as never, file as never, morningStack, settings(), { time: '07:00' });

    const result = await fm(app, file);
    expect(result['title']).toBe('Monday');
    expect(result['mood']).toBe(7);
  });
});
