---
"@emdash-cms/plugin-cli": patch
---

Fixes `emdash-plugin init` inheriting a parent repository's remote when it runs
from a Git hook against a different target directory.
