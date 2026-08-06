# Contributing to Vital Log

Contributions are welcome through issues and pull requests on [GitHub](https://github.com/connradolisboa/obsidian-vital-log).

## Requirements

- Node.js 20
- npm
- An Obsidian test vault for interactive testing

## Local Setup

```bash
git clone https://github.com/connradolisboa/obsidian-vital-log.git
cd obsidian-vital-log
npm ci
```

## Development

Run the watch build while developing:

```bash
npm run dev
```

For manual testing, first create a production package:

```bash
npm run build
```

Then copy these generated files from `dist/` into `<vault>/.obsidian/plugins/vital-log/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian and enable Vital Log under **Settings → Community Plugins**.

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
git diff --check
```

Confirm that `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` exist and smoke-test affected behavior in a real vault. Build and unit-test success do not replace desktop or mobile UI testing.

## Pull Requests

1. Keep each pull request focused on one change.
2. Add or update tests for behavior changes.
3. Update the README or changelog when user-facing behavior changes.
4. Describe any desktop, mobile, or migration testing that remains outstanding.

## Release Checklist

1. Update `package.json`, `manifest.json`, and `versions.json` to the same version.
2. Add release notes to `CHANGELOG.md`.
3. Run the complete validation sequence above.
4. Upload `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` to the GitHub release.

## Related

- [README](README.md) - User guide
- [Feature Roadmap](FEATURES.md) - Planned work
- [Changelog](CHANGELOG.md) - Changes by release
