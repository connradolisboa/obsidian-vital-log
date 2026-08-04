# Vital Log

An Obsidian plugin for logging vitamins, supplements, wellness trackers, tally counters, and custom forms into your notes — with minimal friction.

All data lands in your vault as clean YAML frontmatter, queryable by DataView or any other plugin.

---

## Table of Contents

- [Features Overview](#features-overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Supplement Logging](#supplement-logging)
- [Wellness Trackers](#wellness-trackers)
- [Tally Counters](#tally-counters)
- [Custom Modals](#custom-modals)
- [Embedded Modals](#embedded-modals)
- [Inline Widgets](#inline-widgets)
- [Note Content Appending](#note-content-appending)
- [Commands & Ribbon Icons](#commands--ribbon-icons)
- [Frontmatter Reference](#frontmatter-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Features Overview

| Feature | Description |
|---|---|
| Supplement logging | Log vitamins, packs, and stacks into daily note frontmatter |
| Wellness trackers | Mood, energy, and custom numeric trackers |
| Tally counters | Daily running counts with targets, step sizes, and status bar display |
| Custom modals | Build your own logging forms with 10 field types |
| Embedded modals | Render any custom modal as an interactive card inside a note |
| Inline tally widget | `\`tally: Name\`` renders a live counter anywhere in a note |
| Inline counter widget | `\`counter: Name\`` renders a free-form counter that saves its value on the same line |
| Mirror mode | Modals that automatically show only the properties the current note already has |
| Sections | Collapsible, color-coded sections, headers, and dividers inside modals and embeds |
| Note appending | Optionally write a formatted line to note body content when logging |

---

## Installation

### From Obsidian Community Plugins

1. Open **Settings** → **Community Plugins**
2. Search for **Vital Log**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download the latest release from GitHub
2. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/vital-log/`
3. Reload Obsidian and enable the plugin in **Settings → Community Plugins**

---

## Quick Start

### 1. Set Your Note Path

In **Settings → Vital Log → General**, configure the path to your daily (or any periodic) note:

```
Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}
```

Supported tokens:

| Token | Output |
|---|---|
| `{{YYYY}}` | Full year (2026) |
| `{{YY}}` | 2-digit year (26) |
| `{{MM}}` | Month (01–12) |
| `{{MMMM}}` | Month name (January…) |
| `{{DD}}` | Day (01–31) |
| `{{dddd}}` | Weekday name (Monday…) |
| `{{ddd}}` | Short weekday (Mon…) |
| `{{Q}}` | Quarter (1–4) |
| `{{WW}}` | ISO week number |

### 2. Add Vitamins (Optional)

**Settings → Vital Log → General → Manage Data → Vitamins → Open Manager**

Add vitamins with a display name, property key (e.g. `vitaminC`), default amount, and unit.

### 3. Log Something

Press the **pill icon** in the ribbon or use **Cmd/Ctrl+P** → *Log Supplement*.

---

## Supplement Logging

### Vitamins

Log individual vitamins with a custom amount, time, and optional note. Two storage modes:

**Per-Vitamin mode** — each vitamin gets its own frontmatter key:
```yaml
vitaminC:
  - time: "09:00"
    amount: 500
    unit: "mg"
    source: "manual"
```

**Substances mode** — all entries in a flat list:
```yaml
substances:
  - name: "Vitamin C"
    amount: 500
    unit: "mg"
    time: "09:00"
    source: "manual"
```

Switch between modes in **Settings → Vital Log → General → Log Mode**.

### Packs

Group vitamins into reusable packs (e.g. "Morning Vitamins"). Log an entire pack with one click. Each pack item can override the vitamin's default amount.

**Settings → Vital Log → Manage Packs**

```yaml
packs:
  - time: "08:00"
    name: "Morning Vitamins"
```

### Stacks

Combine packs and individual vitamins into named stacks with a scheduling hint (Morning, Evening, Pre-workout, Post-workout, Custom). Log everything in a stack at once.

**Settings → Vital Log → Manage Stacks**

```yaml
stacks:
  - time: "09:00"
    name: "Morning Stack"
```

### Log Source Tracking

Enable **Log Source** in settings to record where each entry came from:
- `"manual"` — logged individually
- Pack/stack display name — logged as part of a group

### Pack & Stack Entry Toggle

Independently enable or disable writing `packs: [...]` and `stacks: [...]` entries to frontmatter.

---

## Wellness Trackers

Numeric trackers with a configurable range. Two built-in trackers (Mood and Energy, 1–5 scale) and unlimited custom ones.

**Settings → Vital Log → Trackers → Add Tracker**

Fields: display name, frontmatter property key, value field name, min, max, icon.

```yaml
moodLog:
  - time: "21:00"
    mood: 4
    note: "Good day"
energyLog:
  - time: "14:00"
    energy: 3
```

Access via the **activity icon** in the ribbon or *Log Tracker* command.

---

## Tally Counters

Running daily counts with a target. Great for habits, repetitions, servings — anything you want to count toward a goal.

**Settings → Vital Log → Tally Counters → Add Counter**

Options per counter:
- **Display name** and **icon**
- **Property key** — frontmatter key
- **Target** — visual goal shown as `value / target`
- **Step** — how much each click adds or subtracts
- **Show in status bar** — display current/target in the Obsidian status bar
- **Append to note** — optional vault path to append tally lines to a specific note

```yaml
outreachTally:
  value: 7
```

Counters mark themselves complete (visual highlight) once the value reaches the target.

---

## Custom Modals

Build your own logging forms. Each modal becomes a ribbon icon and a command.

**Settings → Vital Log → Custom Modals → Add Custom Modal**

### Field Types

| Type | Description |
|---|---|
| `slider` | Horizontal range slider (configurable min/max/step) |
| `text` | Single-line text input |
| `textarea` | Multi-line text box |
| `number` | Numeric input |
| `date` | Date picker (outputs `YYYY-MM-DD`) |
| `time` | Time picker (outputs `HH:mm`) |
| `checkbox` | Toggle (outputs `true`/`false`) |
| `dropdown` | Select from a list of options |
| `rating` | Button grid (configurable min/max, outputs a number) |
| `tags` | Multi-select chip input (outputs a string array) |

### Structure Items

Add visual structure to any modal or embed:

- **Header** — a bold label line
- **Divider** — a horizontal rule
- **Section** — a collapsible group with an optional accent color and open/closed default state

### Tally Items

Drop any tally counter directly into a custom modal as a +/− row.

### Button Items

Add action buttons to a modal that either:
- **Open a file** — navigates to a vault note
- **Run a command** — executes any Obsidian command by ID

### Templater Integration

Enable **Use Templater** on a modal to automatically create a new note from a template file when the target note doesn't exist yet.

### Mirror Mode

Enable **Mirror Mode** on any custom modal to make it context-aware: instead of showing all configured fields, the modal shows only the fields whose frontmatter keys already exist in the current note.

**Pinned fields** always show in mirror mode regardless. Pin them in the modal settings.

**Conditional pins** pin fields based on the note's tags or folder — e.g. always show `projectLog` when the note has the `#work` tag.

**Other Properties** — optionally show a collapsed "Other Properties" section listing all other frontmatter keys in the note that aren't covered by the modal's fields.

Configure excluded keys (keys to never show in Other Properties) at **Settings → Vital Log → Mirror Excluded Keys**.

---

## Embedded Modals

Render any custom modal as an interactive card directly inside a note using a fenced code block:

````
```vital-log
My Modal Name
```
````

### Options

Add one option per line after the modal name:

| Option | Effect |
|---|---|
| `invisible` | Removes the card border/header — blends into the note |
| `+` | Collapsible, starts **expanded** |
| `-` | Collapsible, starts **collapsed** |

**Example — invisible embed:**
````
```vital-log
Daily Review
invisible
```
````

**Example — collapsible, starts collapsed:**
````
```vital-log
Morning Checklist
-
```
````

### Note Path Behaviour

- If the modal's note path is empty, the embed reads from and writes to the **note it lives in**.
- If the modal has a note path configured, it targets that path (following the same date tokens as daily notes).

---

## Inline Widgets

Render interactive counters anywhere inside a note using inline code syntax. These work in reading view.

### Inline Tally — `tally: Name`

Links to a tally counter defined in settings. Displays the current value, target, and +/− buttons.

```
Today I did `tally: Pushups` sets.
```

- Reads and writes to today's daily note
- Marks complete when the value reaches the counter's target
- Shows the icon configured in tally settings

If the named tally counter isn't found in settings, it renders an error label.

### Inline Counter — `counter: Name`

A free-form counter that doesn't require any settings configuration. It stores its value directly on the same line in the note file — the number sitting immediately before the counter tag.

```
Water glasses: 3 `counter: Water`
Fried chicken: 0 `counter: Fried Chicken`
```

Clicking + or − updates the number in-place. If no number exists before the tag yet, one is inserted automatically.

---

## Note Content Appending

In addition to writing to frontmatter, Vital Log can append a formatted line to the note body when you log.

Enable the **Append to Note** checkbox in the log modal (or set the default in settings).

### Templates

Customize the appended line in **Settings → Vital Log → General**:

| Template | Available tokens |
|---|---|
| Supplements | `{time}` `{name}` `{amount}` `{unit}` `{note}` |
| Trackers | `{time}` `{name}` `{value}` `{note}` |
| Tallies | `{name}` `{value}` `{target}` |
| Tally specific-note | `{dailyNote}` `{time}` `{name}` `{value}` `{target}` |

Default supplement template:
```
- {time} {name} {amount}{unit}
```

---

## Commands & Ribbon Icons

### Ribbon Icons

| Icon | Action |
|---|---|
| Pill | Open main supplement log modal |
| Activity | Open tracker modal |
| Grid | Open custom modal chooser |
| One icon per custom modal | Open that specific modal directly |

### Command Palette

- **Log Vitamin** — open log modal on the Vitamin tab
- **Log Pack** — open log modal on the Pack tab
- **Log Stack** — open log modal on the Stack tab
- **Log Tracker** — open tracker modal
- **View History** — browse all logged entries across daily notes
- **Manage Vitamins / Packs / Stacks** — open management interface
- *One command per custom modal* — auto-generated from modal display names

---

## Frontmatter Reference

### Vitamin — Per-Vitamin Mode

```yaml
vitaminC:
  - time: "09:00"
    amount: 500
    unit: "mg"
    note: "With food"       # optional
    source: "Morning Stack" # optional
```

### Vitamin — Substances Mode

```yaml
substances:
  - name: "Vitamin C"
    amount: 500
    unit: "mg"
    time: "09:00"
    note: "With food"       # optional
    source: "manual"        # optional
```

### Pack Entry

```yaml
packs:
  - time: "09:00"
    name: "Morning Vitamins"
    source: "manual"        # optional
```

### Stack Entry

```yaml
stacks:
  - time: "09:00"
    name: "Morning Stack"
```

### Tracker Entry

```yaml
moodLog:
  - time: "21:00"
    mood: 4
    note: "Good day"        # optional
```

### Tally Counter Entry

```yaml
outreachTally:
  value: 7
```

### Custom Modal Entry

```yaml
dayReview: 9
sleepQuality: 7
weatherNotes: "Sunny"
tags: ["productive", "energized"]
```

---

## Keyboard Shortcuts

All features are reachable from:
- **Ribbon icons** — one-click access from the left sidebar
- **Command Palette** — Cmd/Ctrl+P
- **Custom hotkeys** — assign any command in **Settings → Hotkeys**

---

## Troubleshooting

**Daily note not found**

Verify your note path template in settings matches your vault's folder structure. Use the date tokens listed in Quick Start. Enable *Create missing files* in Obsidian's Daily Notes plugin if you use it.

**Vitamin missing from pack**

Happens when you delete a vitamin that's still referenced by a pack or stack. The
rest of the pack is still logged, and a notice names the references that were
skipped. Open the pack manager and remove the stale item to stop the warning.

**Custom modal missing from the Command Palette**

Commands are re-registered as soon as you add, rename, or archive a modal, so no
reload is needed. Note that custom modals do not each get their own ribbon icon —
they are reached through the single **Custom Modals** ribbon icon, or by the
per-modal command in the palette.

**"Could not parse the frontmatter" notice**

The note's YAML frontmatter is malformed — often an unclosed quote or a stray
tab. Nothing is written while the file is in that state, so your existing
properties are left intact. Fix the YAML and log again.

**Templater not running**

Ensure the Templater community plugin is installed and enabled, and that the template file path in Vital Log settings points to an existing note.

**Inline `tally: Name` shows an error**

The name must exactly match the **Display Name** of a tally counter in settings (case-insensitive).

---

## License

MIT — use, modify, and distribute freely.

---

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/connradolisboa/obsidian-vital-log).

Before opening a pull request:

```bash
npm install
npm run typecheck   # tsc, no emit
npm test            # vitest
npm run build       # bundles main.js and refreshes dist/
```
