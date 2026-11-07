---
"@emdash-cms/cloudflare": minor
---

Adds a `prefix` option to the `r2()` storage adapter so EmDash can share an R2 bucket with other applications. EmDash then reads and writes every media file and automatic backup under that folder, for example `r2({ binding: "MEDIA", prefix: "site/" })`. Media keys stored in the database stay unchanged, and public bucket URLs built from `publicUrl` include the folder. Without `prefix`, objects stay at the bucket root as before.
