---
"@emdash-cms/sandbox-workerd": patch
---

Fixes a sandboxed plugin loaded while workerd is starting being left out of the running sandbox. Starting workerd now waits for plugins that are still being registered and restarts once to include them.
