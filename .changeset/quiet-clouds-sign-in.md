---
"@superboard/web": patch
---

Fixes identity token handling so malformed stored credentials and incomplete authentication responses are rejected before they are used. Valid sessions and custom ID token claims remain supported.
