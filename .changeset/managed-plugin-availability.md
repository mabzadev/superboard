---
"emdash": patch
"@emdash-cms/admin": patch
---

Fixes host-managed plugin status changes so lifecycle hook failures reach the host activation workflow, repeated activation does not fire activation hooks twice, and disabled plugins stop their scheduled tasks. The Plugin Manager refreshes cached content lists after an activation change.

Adds `locals.emdash.inspectPluginHealth(pluginId, request, user)` for host activation workflows to inspect a loaded plugin's `health` route while its business routes remain disabled.
