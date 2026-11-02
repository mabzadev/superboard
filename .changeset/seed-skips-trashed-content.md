---
"emdash": patch
---

Fixes re-applying a seed after content from that seed was moved to the trash. `applySeed()` now skips a trashed entry (or reports a conflict with `onConflict: "error"`) instead of failing with a `UNIQUE constraint failed` error, and it no longer restores content an editor deleted. The dev setup bypass (`/_emdash/api/setup/dev-bypass`) can therefore be opened again on an existing site.
