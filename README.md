# Vital Log

A powerful Obsidian plugin for systematically logging vitamins, supplements, stacks, and wellness trackers into your daily notes with minimal friction.

## Overview

Vital Log transforms supplement tracking in Obsidian. Rather than manually typing entries or remembering what you took, this plugin provides:

- **Quick-logging modals** for vitamins, supplement packs, and custom stacks
- **Flexible frontmatter storage** with two log modes (per-vitamin keys or flat substances list)
- **Wellness trackers** (mood, energy, custom metrics) with configurable ranges
- **Custom modals** for any periodic note with user-defined fields
- **History viewer** to see all logged entries in your daily notes

Your supplement data lives in your vault's daily notes as clean, queryable YAML frontmatter—giving you full control and the ability to analyze patterns over time.

---

## Features

### Core Features

#### 1. **Vitamin & Supplement Logging**
- Log individual vitamins with custom amounts and times
- Include notes and track the source (manual, pack, or stack)
- Support for multiple units (mg, IU, mcg, g, etc.)
- Two logging modes:
  - **Per-Vitamin**: Each vitamin gets its own frontmatter key (e.g., `vitaminC: [...]`)
  - **Substances**: All entries in a single flat `substances: [...]` array

#### 2. **Supplement Packs**
- Group multiple vitamins into reusable packs (e.g., "Multivitamin", "Immune Support Pack")
- Log entire packs with a single click
- Each pack item can have custom amounts different from the vitamin's default
- Automatically track which pack was the source

#### 3. **Supplement Stacks**
- Combine packs and individual vitamins into themed stacks
- Scheduling hints for organization (Morning, Evening, Pre-workout, Post-workout, Custom)
- Log all items in a stack simultaneously
- Perfect for coordinated supplement routines

#### 4. **Wellness Trackers**
- Pre-configured trackers: Mood and Energy (1–5 scale)
- Create unlimited custom trackers with:
  - Custom display names and frontmatter keys
  - Configurable min/max values
  - Custom Obsidian icons
- Each tracker gets its own frontmatter list

#### 5. **Custom Modals**
- Build custom logging forms for any periodic note
- Supported field types:
  - **Sliders** (configurable min/max/step)
  - **Text input** (single-line)
  - **Textarea** (multi-line)
  - **Number input**
  - **Date picker**
  - **Checkbox** (toggle)
  - **Dropdown** (select from options)
  - **Time picker**
  - **Rating** (button grid)
  - **Tags** (multi-select)
- Optional Templater integration for automatic note creation
- Each modal writes to its own note path with custom frontmatter keys

#### 6. **History & Analytics**
- View all logged entries across your daily notes
- Filter by date range, tracker, or vitamin
- Analyze patterns in your wellness data
- Built-in note link previews

---

## Installation

### From Obsidian Community Plugins

1. Open **Settings** → **Community Plugins**
2. Disable safe mode if needed
3. Search for "Vital Log"
4. Install the plugin
5. Enable it in Community Plugins list

### Manual Installation

1. Clone or download this repository
2. Copy the plugin files to `.obsidian/plugins/vital-log/`
3. Reload Obsidian
4. Enable the plugin in Settings

---

## Quick Start

### 1. Set Your Daily Note Path

In **Settings** → **Vital Log** → **General**:

```
Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}
```

Supported tokens:
- `{{YYYY}}` – Full year (e.g., 2026)
- `{{YY}}` – 2-digit year (e.g., 26)
- `{{MM}}` – Month (01–12)
- `{{DD}}` – Day (01–31)
- `{{dddd}}` – Weekday name (Monday, Tuesday, etc.)
- `{{ddd}}` – Short weekday (Mon, Tue, etc.)
- `{{Q}}` – Quarter (1–4)
- `{{WW}}` – ISO week number
- `{{MMMM}}` – Month name (January, February, etc.)

### 2. Add Vitamins

1. Open **Settings** → **Vital Log** → **General** → **Manage Data** → **Vitamins**
2. Click **Open Manager**
3. Add vitamins with:
   - **Display Name** (e.g., "Vitamin C")
   - **Property Key** (e.g., "vitaminC" — unique identifier)
   - **Default Amount** (e.g., 500)
   - **Unit** (e.g., "mg")

### 3. Create Packs (Optional)

1. Open **Settings** → **Vital Log** → **Manage Packs**
2. Click **Open Manager**
3. Create a pack (e.g., "Morning Stack") and add vitamins with specific amounts

### 4. Start Logging

Press the **Vital Log** ribbon icon or use a command:
- **Log Vitamin** – Quick-log a single vitamin
- **Log Pack** – Log an entire pack
- **Log Stack** – Log all items in a stack

---

## Configuration

### General Settings

#### Log Mode
- **Per-Vitamin**: Each vitamin gets its own frontmatter key
  ```yaml
  vitaminC:
    - time: "09:00"
      amount: 500
      unit: "mg"
      source: "manual"
  ```

- **Substances**: Flat list of all logged entries
  ```yaml
  substances:
    - name: "Vitamin C"
      amount: 500
      unit: "mg"
      time: "09:00"
      source: "manual"
  ```

#### Log Source
Toggle to include a `source` field on each entry tracking where it came from:
- "manual" – logged individually
- Pack display name – logged as part of a pack
- Stack display name – logged as part of a stack

#### Log Pack & Stack Entries
- **Log Pack Entries**: Write a `packs: [...]` array when logging packs
- **Log Stack Entries**: Write a `stacks: [...]` array when logging stacks

### Trackers Tab

Mood and Energy come pre-configured. Add custom trackers by clicking **Add Tracker**:

- **Display Name**: "Sleep Quality"
- **Property Key**: "sleepLog" (frontmatter key)
- **Value Name**: "sleep" (field name inside entries)
- **Min/Max**: 1–10

### Custom Modals Tab

Create unlimited custom logging forms:

1. Click **Add Custom Modal**
2. Set a display name, icon, and note path
3. Add fields with different types
4. Optional: Enable Templater integration for auto-note-creation

Each custom modal appears as a ribbon icon and command.

---

## Use Cases

### Health & Wellness Tracking

Track your daily supplement routine alongside mood, energy, and sleep:

```yaml
---
vitaminC:
  - time: "09:00"
    amount: 500
    unit: "mg"
    source: "Morning Stack"
moodLog:
  - time: "21:00"
    mood: 7
    note: "Great day"
energyLog:
  - time: "14:00"
    energy: 5
  - time: "21:00"
    energy: 3
stacks:
  - time: "09:00"
    name: "Morning Stack"
---
```

### Biohacking & Experimentation

Log supplements alongside custom metrics (sleep quality, workout performance, digestion):

- Create custom modals for **Digestion Score**, **Workout Performance**, **Sleep Duration**
- Cross-reference your supplement intake with outcomes
- Identify patterns using Obsidian's DataView or similar plugins

### Medication & Supplement Adherence

Track which medications/supplements were taken, at what time, and from which pack:

```yaml
---
packs:
  - time: "08:00"
    name: "Morning Meds"
    source: "manual"
  - time: "20:00"
    name: "Evening Meds"
    source: "manual"
---
```

### Sports & Athletic Performance

Log pre-workout stacks, intra-workout supplements, and post-workout recovery stacks:

- Define stacks: "Pre-Workout", "Intra-Workout", "Post-Workout"
- Track alongside workout notes and performance metrics
- Use custom modals to log workout intensity, mood, recovery

### Family Health Management

If tracking multiple people's supplements, create custom modals per person writing to different note paths:

```
Wellness/{{YYYY-MM-DD}}/Alice/Supplements
Wellness/{{YYYY-MM-DD}}/Bob/Supplements
```

---

## Frontmatter Format

### Vitamin Entry (Per-Vitamin Mode)

```yaml
vitaminC:
  - time: "09:00"           # HH:mm format
    amount: 500
    unit: "mg"
    note: "With food"       # optional
    source: "manual"        # optional (if logSource=true)
```

### Vitamin Entry (Substances Mode)

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
    name: "Multivitamin"
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
    mood: 7                 # configurable field name
    note: "Great day"       # optional
```

### Custom Modal Entry

Custom modals create frontmatter keys based on your field definitions:

```yaml
dayReview: 9
sleepQuality: 7
weatherNotes: "Sunny"
tags: ["productive", "energized"]
```

---

## Commands

### Ribbon Icons
- **Vital Log: Log Supplement** (pill icon) – Main logging modal
- **Vital Log: Log Tracker** (activity icon) – Quick tracker logging
- **Vital Log: Custom Modals** (grid icon) – Custom modal chooser

### Commands
- **Log Vitamin** – Open log modal with Vitamin tab active
- **Log Pack** – Open log modal with Pack tab active
- **Log Stack** – Open log modal with Stack tab active
- **Log Tracker** – Open tracker modal
- **View History** – View all logged entries
- **Manage Vitamins / Packs / Stacks** – Open management interface
- *Custom Modal Commands* – One command per custom modal (auto-generated)

---

## Tips & Best Practices

### Organization
- **Group related vitamins** into packs (e.g., "Immune Support", "Energy Boost")
- **Create stacks for routines** (Morning, Evening, Pre-workout, Post-workout)
- **Name packs/stacks clearly** so the source field is meaningful

### Analytics
- Use **Obsidian DataView** or **JavaScript Queries** to aggregate your logs
- Example: "Show average mood on days when I took the Morning Stack"
- Create custom dashboard notes that query your daily notes

### Custom Modals
- Use custom modals for **non-supplement data** (mood details, workout notes, food intake)
- Enable **Templater integration** to auto-create new note structures
- **Multiple custom modals** can write to the same note (they append)

### Data Consistency
- Keep frontmatter keys **lowercase and camelCase** (auto-slugified)
- Avoid changing property keys once you've started logging (they become part of your data structure)
- Use **source field** to distinguish manual vs. automated logs

---

## Troubleshooting

### "Daily note path doesn't exist"

**Solution**: Ensure the path template matches your vault structure and enable "Create missing files" in Obsidian's Daily Notes plugin settings.

### "Vitamin not found in pack"

This happens when you delete a vitamin but don't remove it from a pack. **Fix**: Open the pack manager and remove the missing vitamin.

### Custom modals aren't appearing

**Solution**:
1. Ensure you've created the modal in Settings
2. Reload Obsidian with Cmd/Ctrl+R
3. Check the ribbon icon or open the Custom Modal Chooser

### Templateer isn't running

**Solution**: Ensure the Templater plugin is installed and enabled, and that your template file exists at the specified path.

---

## Keyboard Shortcuts

All features are accessible through:
- **Ribbon icons** (quick access from sidebar)
- **Command Palette** (Cmd/Ctrl+P)
- **Custom hotkeys** (set in Obsidian Settings → Hotkeys)

---

## Roadmap & Future Features

Potential enhancements:
- Visualization of supplement intake patterns
- Integration with health APIs
- Batch logging UI
- Import/export for backup and sharing
- Monthly/quarterly summaries
- Supplement interaction warnings
- Mobile optimizations

---

## Support & Feedback

If you encounter bugs or have feature requests, please open an issue on [GitHub](https://github.com/yourusername/vital-log).

---

## License

MIT License – feel free to use, modify, and distribute.

---

## Contributing

Contributions are welcome! Feel free to submit pull requests or open issues for discussion.

---

**Start tracking your wellness today with Vital Log!** 💊✨
