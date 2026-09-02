---
"emdash": minor
---

Adds `defaultEnabled` and `lifecycleManaged` to plugin descriptors. Set `defaultEnabled: false` for a statically configured sandboxed plugin that should appear in the plugin catalog but remain inactive until persisted lifecycle state marks it active. Set `lifecycleManaged: true` when a host workflow must reject the generic enable and disable actions in **Plugins**.

`defaultEnabled` remains `true` and `lifecycleManaged` defaults to `false`, so existing plugin configurations keep their current activation behavior.
