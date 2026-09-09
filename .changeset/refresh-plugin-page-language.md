---
"@emdash-cms/admin": patch
---

Fixes Block Kit plugin pages retaining their previous language after changing the admin language. Plugin requests receive the selected language, and responses from an earlier page load cannot overwrite the translated content.

Exposes the standalone locale resolver at `@emdash-cms/admin/locales/config.js` for server integrations.
