// ============================================================
// Vital Log — test stub for the `obsidian` module
//
// The real `obsidian` package ships types only: there is no runtime to import
// under Vitest. This provides just enough of the API for the UI-free modules
// (yamlManager, vitaminManager, keySnapshotManager, …) to run against an
// in-memory vault.
//
// parseYaml/stringifyYaml delegate to js-yaml, which is what Obsidian itself
// uses — so a document that throws here throws in the app too.
// ============================================================

import { load, dump } from 'js-yaml';

export function parseYaml(input: string): unknown {
  return load(input);
}

export function stringifyYaml(input: unknown): string {
  return dump(input);
}

/** Every Notice raised during a test, newest last. Cleared by `resetNotices()`. */
export const notices: string[] = [];

export function resetNotices(): void {
  notices.length = 0;
}

export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

export class TFile {
  path: string;
  /** Filename without extension, mirroring Obsidian's own `basename`. */
  basename: string;

  constructor(path: string) {
    this.path = path;
    const name = path.split('/').pop() ?? path;
    this.basename = name.replace(/\.md$/, '');
  }
}

/**
 * In-memory stand-in for Obsidian's Vault.
 *
 * `process` mirrors the real contract that matters here: the callback receives
 * the current content and whatever it returns becomes the new content, so a
 * callback returning its input unchanged is a genuine no-op write.
 */
export class Vault {
  private files = new Map<string, string>();

  create(path: string, content: string): TFile {
    this.files.set(path, content);
    return new TFile(path);
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? '';
  }

  async process(file: TFile, fn: (content: string) => string): Promise<string> {
    const next = fn(this.files.get(file.path) ?? '');
    this.files.set(file.path, next);
    return next;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.keys()].filter((p) => p.endsWith('.md')).map((p) => new TFile(p));
  }

  /** Test-only: read a file's raw content without a TFile handle. */
  raw(path: string): string {
    return this.files.get(path) ?? '';
  }
}

export class App {
  vault = new Vault();
}
