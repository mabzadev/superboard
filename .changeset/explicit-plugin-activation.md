---
"emdash": minor
---

Adds `defaultEnabled` to plugin descriptors. Set it to `false` for a statically configured sandboxed plugin that should appear in the plugin catalog but remain inactive until an administrator enables it or persisted lifecycle state marks it active.

The default remains `true`, so existing plugin configurations keep their current activation behavior.
