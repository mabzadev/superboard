---
"emdash": patch
---

Fixes comment Turnstile verification to read secret keys at runtime, so production builds do not embed a build-machine key or override a rotated deployment secret. Set `EMDASH_TURNSTILE_SECRET_KEY` or `TURNSTILE_SECRET_KEY` in the deployment runtime. Verification also rejects unsuccessful HTTP responses from the verification service.
