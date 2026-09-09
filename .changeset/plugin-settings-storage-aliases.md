---
"emdash": minor
---

Adds `emdash/api/plugin-settings` and an optional storage-key resolver to its settings handlers so trusted host integrations can retain existing settings when grouping or renaming plugins. Reads, writes, clearing values and secret masking all use the same resolver; the default storage keys are unchanged.
