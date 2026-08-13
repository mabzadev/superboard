# SuperBoard Email Worker

Common delivery authority for transactional, marketing, and test email.

- `capture` stores development mail for the protected preview origin declared by
  the selected target manifest.
- `smtp` queues delivery and uses the shared `@superboard/email-transport`
  package. Managed targets use the regional Amazon SES SMTP endpoint on port
  587 with STARTTLS; the target manifest owns the region and configuration-set
  name while the SMTP credential remains a Worker secret.
- callers use the private `EMAIL_SERVICE` binding and `POST /internal/v1/messages`, authenticated with the shared `EMAIL_INTERNAL_TOKEN` secret.
- Marketing uses the same private binding and
  `POST /internal/v1/transport/smtp` after it has selected a project profile,
  enforced consent/quotas and materialized personalization/tracking. Email is
  the sole Worker that opens SMTP sockets and keeps an idempotent delegated
  transport receipt without persisting the caller's credential or body.
- every SMTP attempt uses a deterministic Message-ID derived from its
  idempotency identity. Provider acceptance (`250`) is the side-effect boundary;
  a lost `QUIT`, an unconfirmed response after `DATA`, or a failed D1 receipt
  write can never move that identity back to an automatically retryable state.
  Ambiguous outcomes are exposed as `outcome_unknown` for operator
  reconciliation in Infrastructure.
- Amazon SES returns its own provider Message ID at the SMTP `250 Ok`
  boundary. The public `/api/v1/email/aws-ses/events` route accepts only the
  configured SNS topic, validates the SNS certificate URL and RSA signature,
  deduplicates the SNS Message ID in Email D1, and exports a recipient-free
  normalized result to Marketing. Marketing acknowledges the result only
  after its own idempotent projection succeeds.
- the authenticated back-office control plane uses the same private binding to
  list body-free message operations and quarantined jobs under
  `/internal/v1/operations`; replay and discard decisions are persisted before
  the Worker returns.
- `AWS_SES_SMTP_USERNAME`, `AWS_SES_SMTP_PASSWORD` and
  `AWS_SES_SNS_TOPIC_ARN` are Email Worker secrets. Project-level Marketing
  sender profiles never receive or forward these credentials in managed SES
  mode; manifests contain only public sender and regional metadata.

The Marketing Worker owns contacts, consent, segments, templates, campaigns,
project SMTP profiles, quotas and failover. It delegates only the final SMTP
side effect to this Worker; it must not become a second transport authority.
