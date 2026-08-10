# OpenGrow Reference acceptance runbook

This runbook is the executable acceptance contract for the sixteen reference
journeys. Run it on `https://reference.mbza.dev` only after the development
platform revision and reference build revision shown by CI are identical to the
revisions under review.

The reference application contains UI and orchestration only. Every network or
business operation below is implemented by the public OpenGrow FlutterFlow
packages from `opengrow-platform`; the application does not reproduce API
paths, private Worker tokens, signatures, retry rules or business policy.

## Safety preconditions

1. Use the `mbza-development` target and a test project.
2. Confirm `/infrastructure` on `https://grow.mbza.dev` reports the API,
   Identity, Files and each enabled feature Worker as healthy.
3. Build with `OPENGROW_LIVE_MODE=true`, a positive test project ID, the
   registered Web identifier, and the SDK access key supplied through the
   protected GitHub `development` Environment. Never commit that key.
   The live build must also display the exact platform and reference Git SHAs
   produced by CI; `local` provenance is not accepted for MBZA evidence.
4. Use unique email addresses, idempotency keys, client conversation IDs and
   client message IDs for each manual acceptance run.
5. Keep provider credentials, access/refresh tokens and reset tokens out of
   screenshots, issues, logs and committed fixtures.
6. Do not point this build at VocoStar or another production target. Promotion
   happens only after every applicable row below is accepted on MBZA.

## Recommended sequence

Run Bootstrap first, then Create account or Sign in. Keep that authenticated
session for Profile, Notifications, Files, Products, Paywall, Support,
Marketing and Custom extension. Run account deletion last because it clears the
session and permanently removes application-owned data according to server
policy.

## Journey and operation matrix

|   # | Page              | Input or operation                                                                                                                                                                                     | Public library execution                                                                                                          | Acceptance evidence                                                                                                                                                                                                                      |
| --: | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Bootstrap         | `{"app_version":"0.1.0","build":"1"}`                                                                                                                                                                  | application initialization, `opengrowInitializeAuto` or authenticated initialization, then `opengrowApplicationRuntimePolicyJson` | target diagnostics contain only configured origins; runtime policy resolves; no fallback VocoStar/MBZA hostname exists in reusable code                                                                                                  |
|   2 | Sign in           | password: `email`, `password`; provider: `provider=google\|apple`, `token`, optional `name`                                                                                                            | `opengrowApplicationSignInPasswordJson` or `opengrowApplicationSignInProviderJson`                                                | nested Identity user, access token and rotating refresh token are accepted and stored securely; invalid credentials remain sanitized                                                                                                     |
|   3 | Create account    | `email`, `password`, `name`                                                                                                                                                                            | `opengrowApplicationRegisterJson`                                                                                                 | registration policy is enforced; session is created only when policy permits; verification mail is visible in the protected development preview                                                                                          |
|   4 | Password recovery | `operation=request`, `email`; then `operation=reset`, `token`, `password`                                                                                                                              | request and reset actions                                                                                                         | request is enumeration-safe; development email contains the one-time flow; token reuse/expiry is refused                                                                                                                                 |
|   5 | Home              | optional `app_version`, `build`                                                                                                                                                                        | profile plus runtime policy actions                                                                                               | current authenticated identity and server-owned feature/runtime policy are returned together                                                                                                                                             |
|   6 | Profile           | `operation=read`; `update_profile` + `name`; `identify` + user fields; `attributes` + object; `logout`; finally `delete`                                                                               | profile, update, identify, attributes, logout and deletion actions                                                                | state reflects each mutation; logout clears both local tokens; deletion clears the session and triggers server-owned purge policy                                                                                                        |
|   7 | Notifications     | `operation=register` + native `push_token`; `inspect`; `display`                                                                                                                                       | push registration, unread count and display actions                                                                               | device registration appears in Infrastructure, unread state is coherent, APNs/FCM delivery is tested on native devices                                                                                                                   |
|   8 | Files             | `operation=upload` + `filename`, `content_type`, and `text` or `bytes_base64`; then `list`, `download` + `file_id`, `delete` + `file_id`                                                               | four application Files actions                                                                                                    | ownership, MIME/size policy, list visibility, exact downloaded byte count and deletion are proven; the UI includes base64 only below the 64 KiB proof ceiling                                                                            |
|   9 | Products          | `operation=inspect`, optional `placement`; `operation=restore`                                                                                                                                         | offerings, customer info, last verified customer info and restore                                                                 | server catalogue and signed/verified entitlement state agree; restore returns updated customer state                                                                                                                                     |
|  10 | Paywall           | `operation=inspect`, `placement`; optional `operation=purchase`, `package_identifier`, `offering_identifier`; click **Render live widget**                                                             | purchase configuration/actions and the real `OpenGrowPaywall` widget                                                              | placement fallback, rendered version, purchase/restore/close/unavailable callbacks and latest verified purchase result are visible                                                                                                       |
|  11 | Dynamic links     | generate with `title` and `data`; inspect callback with `operation=last`                                                                                                                               | generate-link and last-deep-link actions                                                                                          | returned short URL uses `https://in.mbza.dev`; opening it exercises redirect and attribution without an embedded API hostname                                                                                                            |
|  12 | Support inbox     | `configuration`, `list`, `open`, `update`, `messages`, `send`, `upload_attachment`, `download_attachment`, `send_attachment`, `mark_read`, `typing`, `connect`, `disconnect`, `realtime_event`, `csat` | authenticated OpenGrow Support actions only                                                                                       | conversation lifecycle, idempotent client IDs, attachment bytes, realtime, read/typing state and CSAT succeed; no Chatwoot action or URL is used                                                                                         |
|  13 | Marketing consent | `operation=load`; update with `operation=update`, boolean `consented`, object `attributes`, public `list_ids`, stable `idempotency_key`                                                                | `opengrowApplicationMarketingPreferencesJson` and `opengrowApplicationUpdateMarketingConsentJson`                                 | only the verified Identity email is used; only public lists are exposed; replay is idempotent; opt-out is recorded; complaint/hard-bounce/privacy suppressions cannot be weakened or re-subscribed by the app                            |
|  14 | Onboarding        | `placement`, optional `locale` and `attributes`; click **Render live widget**                                                                                                                          | real `OpenGrowOnboarding` widget                                                                                                  | version/targeting resolves; progress, completed/skipped/closed/unavailable callbacks are recorded; unpublished or rolled-back content uses the fallback                                                                                  |
|  15 | Custom extension  | object `payload`, stable `idempotency_key`; after all rows, `operation=acceptance` plus the sixteen evidence entries                                                                                   | create, list, detail and cancellation actions for `reference.echo` or `reference.acceptance`                                      | one public SDK call path proves application JWT exchange, project/subject scoping, durable D1 state and the expected terminal `job_not_cancellable`; the final receipt is bound to both displayed Git SHAs and visible in Infrastructure |
|  16 | Diagnostics       | `{}`                                                                                                                                                                                                   | bounded public API health request plus sanitized local diagnostics                                                                | environment, endpoint set, SDK registration fields and recoverable error are visible; secrets and bearer values are absent                                                                                                               |

## Support operation examples

Reuse IDs returned by the preceding operation. `bytes_base64` is preferred for
binary attachments; the example uses text for readability.

```json
{
  "operation": "open",
  "client_conversation_id": "reference-<run>-1",
  "subject": "MBZA acceptance",
  "custom_attributes": { "source": "reference" }
}
```

```json
{
  "operation": "send",
  "conversation_id": "<conversation-id>",
  "client_message_id": "reference-<run>-message-1",
  "body": "Bonjour depuis OpenGrow Reference",
  "metadata": { "acceptance_run": "<run>" }
}
```

```json
{
  "operation": "upload_attachment",
  "conversation_id": "<conversation-id>",
  "filename": "proof.txt",
  "content_type": "text/plain",
  "text": "OpenGrow Support acceptance"
}
```

```json
{
  "operation": "csat",
  "conversation_id": "<conversation-id>",
  "rating": 5,
  "feedback": "MBZA acceptance passed"
}
```

## Marketing consent invariants

The client sends no email, subscriber ID, project ID or internal role. The API
validates the application bearer with the private Identity Service Binding,
requires a verified email, reconstructs the subscriber identity, signs the
project context, and calls Marketing through its private Service Binding. The
Marketing Worker owns subscriber/list/suppression writes and accepts the
`application` role only on its exact preferences route.

An application can remove an ordinary `unsubscribe` suppression by explicit
re-consent. It can never remove or downgrade `complaint`, `hard_bounce`,
`privacy_delete` or `manual`. Private lists are never returned or selectable by
the application.

## Automated proof before browser acceptance

Run from `opengrow-platform`:

```bash
npm --prefix workers/api run typecheck
npm --prefix workers/marketing run typecheck
npm --prefix workers/marketing test
npm run sdk:catalog:check
npm run sdk:catalog:test
```

Run from `opengrow-reference`:

```bash
npm ci
npm run check
```

The reference tests inject a recording bridge at the public FlutterFlow action
boundary. They prove operation dispatch and state changes without faking a
second network implementation. Cloudflare runtime tests separately prove the
real signed API-to-Marketing contract against migrated D1 storage.

## Promotion receipt

Record the platform commit, reference commit, target, Cloudflare deployment
versions, test project reference, timestamp, tester and result for all sixteen
rows. The two commits must exactly match the full revisions shown in the
Diagnostics journey; the header shows their first twelve characters for quick
comparison. Provider/native-only rows may be marked `not_applicable` only with
a written reason. A failed or skipped required row prevents promotion to
VocoStar.

The authenticated reference application submits the durable receipt through
the Custom extension journey. It derives `target`, `projectEnvironment`, both
Git revisions and `completedAt` from the running build; the tester provides only
the stable idempotency key and the sixteen evidence outcomes:

```json
{
  "operation": "acceptance",
  "idempotency_key": "reference-acceptance-<run>",
  "journeys": [
    {
      "id": "bootstrap",
      "status": "passed",
      "evidence": "runtime policy and target diagnostics accepted"
    }
  ]
}
```

Expand `journeys` to exactly the sixteen IDs in the table. Each entry requires
`passed`, `failed` or `not_applicable` plus bounded, non-secret evidence. The
`not_applicable` outcome is accepted only for `notifications`, `products` and
`paywall`, where native/provider proof may genuinely be unavailable. The
custom Worker rejects missing or duplicate journeys, mutable or absent
revisions, the wrong target, a non-test project or malformed timestamps. A
valid receipt is idempotent and project/user scoped; Infrastructure displays it
under Custom jobs and reports the `reference.acceptance` capability statistics.
Evidence containing obvious bearer, token, password, API-key or provider-secret
patterns is rejected before persistence.
