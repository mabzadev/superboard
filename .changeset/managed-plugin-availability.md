---
"emdash": patch
"@emdash-cms/admin": patch
---

Fixes host-managed plugin status changes so a failing activation hook reaches the host activation workflow and leaves the plugin disabled, repeated activation in the same runtime does not fire activation hooks twice, and disabled plugins stop their scheduled tasks. Disabling a plugin always revokes its access, even when its deactivation hook fails. The Plugin Manager refreshes cached content lists after an activation change.

Adds `locals.emdash.inspectPluginHealth(pluginId, request, user)` for host activation workflows to inspect a loaded plugin's `health` route while its business routes remain disabled.
