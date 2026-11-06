---
"emdash": patch
---

Fixes MCP content tools answering a malformed `publishedAt` or `scheduledAt` with only `Invalid input`. The validation error again states that the value must be an ISO 8601 datetime.
