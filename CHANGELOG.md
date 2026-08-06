# Changelog

## 1.2.0

### Highlights

- Added a dashboard with navigable day views, historical tracker goals, recurring schedules, range statistics, and sparklines. The dashboard is available as a pane, modal, or `vital-dashboard` embed.
- Added checkbox habits with boolean frontmatter storage, dashboard controls, schedules, and streak tracking.
- Added life-event logging with reusable event types, 1–5 severity, optional note-body appending, history support, and optional sparkline markers.
- Added a searchable Obsidian-style command picker for action buttons in custom modals. Existing saved command IDs continue to work.

### Custom modals and interface

- Added tracker items to custom modals and embedded forms.
- Added modal duplication and archiving while preserving archived modal embeds.
- Improved current-note and periodic-note targeting, including virtual-content embeds.
- Added live validation, icon autocomplete, drag-and-drop ordering, confirmation prompts, and mobile keyboard handling across editors.
- Improved history browsing, dashboard controls, inline widgets, and settings organization.

### Reliability

- Added versioned settings migrations and per-field settings validation.
- Added property-key diagnostics and guided frontmatter-key migration after renames.
- Malformed YAML now aborts writes instead of replacing existing frontmatter.
- Compound supplement operations now update frontmatter transactionally.
- Added CI and expanded the automated test suite for settings, YAML writes, property-key migration, and supplement logging.

## 1.1.0

- Previous public release.
