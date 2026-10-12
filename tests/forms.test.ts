import { describe, expect, it } from 'vitest';
import { App } from './stubs/obsidian';
import { formStatusOf, formsOf } from '../src/api';
import { DEFAULT_SETTINGS } from '../src/types';
import type { CustomModalConfig, VitalLogSettings } from '../src/types';

const daily: CustomModalConfig = {
  id: 'm-daily', displayName: 'Daily', icon: 'sun', notePath: 'Daily/{{YYYY-MM-DD}}', useTemplater: false, templatePath: '',
  items: [
    { type: 'header', text: 'Ratings' },
    { type: 'field', field: { id: 'f1', propertyKey: 'moodRate', displayName: 'Mood', description: '', fieldType: 'rating', min: 1, max: 5 } },
    { type: 'field', field: { id: 'f2', propertyKey: 'moodSummary', displayName: 'Mood summary', description: '', fieldType: 'textarea' } },
    { type: 'field', field: { id: 'f3', propertyKey: 'journal', parentKey: 'Habits', displayName: 'Journal', description: '', fieldType: 'checkbox' } },
    { type: 'field', field: { id: 'f4', propertyKey: 'tags', displayName: 'Tags', description: '', fieldType: 'tags' } },
  ],
};
const settings: VitalLogSettings = { ...DEFAULT_SETTINGS, customModals: [daily, { ...daily, id: 'm-old', displayName: 'Old', archived: true }] };

describe('forms for other plugins', () => {
  it('lists the forms that are not archived, with their fields', () => {
    const forms = formsOf(settings);
    expect(forms.map((f) => f.name)).toEqual(['Daily']);
    expect(forms[0].fields).toEqual([
      { key: 'moodRate', name: 'Mood', type: 'rating' },
      { key: 'moodSummary', name: 'Mood summary', type: 'textarea' },
      { key: 'Habits.journal', name: 'Journal', type: 'checkbox' },
      { key: 'tags', name: 'Tags', type: 'tags' },
    ]);
  });

  it('says which fields a note has filled, nested ones and false included', () => {
    const app = new App();
    app.vault.create('Daily/2026-10-12.md', '---\nmoodRate: 4\nmoodSummary: ""\nHabits:\n  journal: false\ntags: []\n---\n');
    expect(formStatusOf(app as never, settings, 'Daily', 'Daily/2026-10-12.md')).toEqual({ filled: ['moodRate', 'Habits.journal'], empty: ['moodSummary', 'tags'] });
    expect(formStatusOf(app as never, settings, 'm-daily', 'Daily/2026-10-12.md')?.filled).toHaveLength(2);
  });

  it('gives nothing for a missing note or form', () => {
    const app = new App();
    expect(formStatusOf(app as never, settings, 'Daily', 'Daily/nope.md')).toBeNull();
    app.vault.create('Daily/2026-10-13.md', '# no frontmatter\n');
    expect(formStatusOf(app as never, settings, 'Nope', 'Daily/2026-10-13.md')).toBeNull();
    expect(formStatusOf(app as never, settings, 'Daily', 'Daily/2026-10-13.md')?.empty).toHaveLength(4);
  });
});
