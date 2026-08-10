# OpenGrow Email Worker

Common delivery authority for transactional, marketing, and test email.

- `capture` stores development mail for the protected preview origin declared by
  the selected target manifest.
- `smtp` queues delivery and uses the shared `@opengrow/email-transport` package.
- callers use the private `EMAIL_SERVICE` binding and `POST /internal/v1/messages`, authenticated with the shared `EMAIL_INTERNAL_TOKEN` secret.
- SMTP passwords and preview tokens are Worker secrets; manifests only contain public sender metadata.

The marketing Worker owns contacts, consent, segments, templates, and campaigns.
It must delegate final transport to this Worker; it must not become a second
transactional-mail authority.
