---
"emdash": patch
---

Fixes upgrading a SuperBoard database that already recorded the `074_plugin_setting_versions` migration. Migrations no longer stop with `corrupted migrations: expected previously executed migration ...`; the EmDash migrations `074_content_deleted_scheduled_index` to `091_redirect_artifacts` are applied after it.
