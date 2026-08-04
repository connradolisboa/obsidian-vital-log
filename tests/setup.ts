// Obsidian exposes moment as a global, and dailyNoteResolver reads it that way.
// Reproduce that here so path-template tests exercise the real formatting code.
import moment from 'moment';

(globalThis as unknown as { moment: unknown }).moment = moment;
