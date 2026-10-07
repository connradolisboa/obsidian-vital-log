# Changelog

## Unreleased

### Highlights

- One log modal for supplements, trackers, and events, with tabs and a shared date and time. Items are picked from chips, recently used first, with a search box for long lists. Events can now be logged to any date.
- New substances, packs, stacks, and event types can be created from the log modal with **+ New**, without opening settings.
- Added the `vital-day` code block: a read-only view of everything logged in a daily note, styled like an embedded modal. Its Chart tab plots trackers across the hours of the day with substances as lettered dots and events as markers; Timeline, Substances, Trackers, and Events tabs list the details. Collapsible with `+` / `-`, with a **+** button that opens the log modal for that day.
- Added an **Include unit field** setting. With it off, the unit is read from the substance's settings.
- Added **Convert Notes** (Settings → Maintenance), which moves per-vitamin entries in existing notes into the flat `substances` list and strips fields that are no longer logged.

- The `vital-day` view gained **Week** (an hour-by-day heatmap of a tracker) and **Insights** (with/without comparisons over 30 days) tabs, a yesterday / 7-day-average comparison line on the chart, event dots, and time markers such as wake-up time, configured in Settings → General → Day View. Name a tab on its own line to open the block on it.
- **-0,5** / **+0,5** buttons beside a substance's amount step by half its default dose. The log modal now keeps one height across tabs.
- `vital-log` embeds have an edit button that opens the modal's configuration.

- With a past daily note open, the log modal and custom-modal commands log to that day. The log modal shows a banner when it's logging to a day other than today, with a **Use today** button.

- `vital-day` has a **Time** tab listing the day's Management Tracker sessions (shown when that plugin's API is available): click a session to edit it, the tab badge counts sessions, the header shows the day's total, and **+** on that tab opens the Time Tracker. Sessions also appear in the Timeline and as shaded bands on the Chart, and the view updates when sessions change.
- The public API is now version 2, adding `renderDay(el, { date, tab?, tabs?, title? }, component)` to draw the day viewer for any date inside another plugin's view.

### Fixes

- Daily notes filed under an older folder layout (e.g. `Calendar/Daily/2025/2025-02-15 Saturday.md` when the template now adds a quarter folder) are recognised as that day's note everywhere: embeds, inline widgets, the day view, history, and logging. Logging to such a day writes into the existing note instead of creating a duplicate at the template path. Previously, embeds in those notes wrote to today's note.

- The `vital-day` header's buttons no longer sit under Obsidian's edit-block (`</>`) button.
- Fields in `vital-log` embeds no longer lose focus to the surrounding editor on mobile, and embeds keep their collapsed state across re-renders. **Embed focus diagnostics** (Settings → Maintenance) reports the cause if a field still needs several taps.

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

## Related

- [README](README.md) - User guide
- [Feature Roadmap](FEATURES.md) - Planned work
- [Contributing](CONTRIBUTING.md) - Development and release workflow
