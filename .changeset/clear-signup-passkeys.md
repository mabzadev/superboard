---
"emdash": patch
"@emdash-cms/admin": patch
"@emdash-cms/auth": patch
---

Fixes passkey self-signup on initialized sites, where creating an account failed with “Setup already complete”. Malformed signup verification tokens return an invalid-token error instead of a server error.
