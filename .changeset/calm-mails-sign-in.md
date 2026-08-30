---
"@emdash-cms/auth": minor
"emdash": minor
"@emdash-cms/admin": minor
"@emdash-cms/cloudflare": patch
---

Adds email-verified initial administrator setup and treats a freshly verified magic link as recent strong reauthentication.

Sites with an active `email:deliver` provider can now choose **Send a sign-in link by email** during first-run setup. The administrator account is not created until the recipient opens the single-use link, which expires after 15 minutes. Passkey setup remains available and unchanged.

Cloudflare Email delivery logs keep provider receipt IDs while omitting recipient addresses and message subjects.
