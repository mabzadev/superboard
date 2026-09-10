---
"@emdash-cms/admin": patch
---

Fixes managed plugin toggles that fail when recent authentication is required. The plugin manager prompts for passkey verification and resumes the pending action after verification; cancelling keeps the plugin state unchanged. API errors retain their error code when the server omits an error message and HTTP status text.
