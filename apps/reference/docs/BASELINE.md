# FlutterFlow reference baseline

## Purpose

The reference project proves that a new application can consume SuperBoard with
configuration only. It must stay generic: no VocoStar bundle ID, API origin,
project key, product identifier, paywall ID, SMTP credential or Chatwoot URL is
allowed in shared code.

## Required pages

1. **Bootstrap** — initializes app state and `SuperBoardBootstrap` with endpoint
   values from environment configuration.
2. **Sign in** — email/password plus Google and Apple sign-in.
3. **Create account** — registration/allowlist behavior and email verification.
4. **Password recovery** — transactional email captured at `mail.mbza.dev`.
5. **Home** — authenticated user and feature availability summary.
6. **Profile** — user identity, attributes, sign-out and account deletion.
7. **Notifications** — push permission, token registration and inbox state.
8. **Files** — upload, progress, listing, download and deletion through common
   SuperBoard contracts.
9. **Products** — offerings, entitlements, purchase, restore and customer info.
10. **Paywall** — remote placement resolution and tracked paywall events.
11. **Dynamic links** — generate, open and inspect attribution/deep-link data.
12. **Support inbox** — conversations, messages, attachments, realtime, typing,
    read receipts and CSAT using SuperBoard Support, never Chatwoot directly.
13. **Marketing consent** — newsletter opt-in/out and subscription preferences.
14. **Onboarding** — remote flow resolution, progression and completion.
15. **Custom extension** — authenticated create/list/detail cycle for a durable
    project/owner-scoped `reference.echo` job and strict `reference.acceptance`
    promotion receipt through the public SDK facade; the app never receives the
    private Worker token.
16. **Diagnostics** — visible environment, SDK versions, endpoints and last
    recoverable integration error; never display secrets.

## Application state

| Key                       | Type        | Persistence        | Source                                  |
| ------------------------- | ----------- | ------------------ | --------------------------------------- |
| `environment`             | string      | build/config       | `development` or `production`           |
| `apiBaseUrl`              | string      | build/config       | target manifest                         |
| `sdkBaseUrl`              | string      | build/config       | target manifest                         |
| `supportBaseUrl`          | string      | build/config       | `api.<app>/api/v1/support-client`       |
| `shortLinksBaseUrl`       | string      | build/config       | target manifest                         |
| `filesBaseUrl`            | string      | build/config       | target manifest                         |
| `projectKey`              | string      | secure/config      | application project setup               |
| `applicationAccessToken`  | string      | secure storage     | application auth gateway                |
| `applicationRefreshToken` | string      | secure storage     | rotating application session            |
| `opengrowIdentityToken`   | string      | memory/refreshable | short-lived token exchange              |
| `currentUserId`           | string      | session            | authenticated profile                   |
| `lastDeepLinkJson`        | JSON string | memory             | SuperBoard callback                       |
| `lastPurchaseResultJson`  | JSON string | memory             | verified purchase callback              |
| `lastCustomerInfoJson`    | JSON string | memory             | verified customer info                  |
| `lastSupportEventJson`    | JSON string | memory             | realtime Support callback               |
| `lastCustomJobJson`       | JSON string | memory             | project/owner-scoped custom job receipt |
| `lastIntegrationError`    | string      | memory             | sanitized SDK error                     |

Endpoints are required action/widget parameters. The SuperBoard Flutter and
FlutterFlow libraries intentionally provide no VocoStar or mbza fallback URL.

## Data ownership

- FlutterFlow holds UI/session state only.
- SuperBoard API owns identities, projects and notification/file orchestration.
- feature Workers own their module data.
- email/marketing/support data is visible through SuperBoard interfaces.
- application-specific conversion/media jobs are reached through the custom
  Worker contract, never hardcoded Worker URLs.

## Import procedure

1. Create the FlutterFlow project named **SuperBoard Reference**.
2. Configure the two public Git dependencies from
   `flutterflow/dependency-snippet.yaml`.
3. Add environment variables matching `reference.project.json`.
4. Build the pages above using library actions/widgets; add only thin
   FlutterFlow adapters when the generated action signature requires it.
5. Reproduce the executable reference shell from `lib/` inside FlutterFlow and
   export any generated UI changes into this repository.
6. Run `npm run check` in CI; it includes configuration tests, Flutter analysis,
   widget/unit tests, and a Web release build.
7. Run the lifecycle-aware SDK gates in [SDK_COVERAGE.md](./SDK_COVERAGE.md), then validate
   the candidate on `mbza.dev` at the exact platform SHA. The SDK release
   workflow pins the verified immutable tags and catalogue commits
   automatically before promotion to VocoStar or another application.
