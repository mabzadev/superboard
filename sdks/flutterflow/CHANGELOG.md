## 3.0.0

- Added FlutterFlow actions and widgets for the native Flows SDK, including
  identification, context/language, workflow commands, floating/slot streams,
  bootstrap, and slot rendering.
- Added automatic native `superboard-commerce` rendering through the verified
  Products purchase and restore boundary without duplicate revenue events.
- Kept the existing Paywall and Onboarding widgets as deprecated compatibility
  adapters served through the Flows legacy contracts.
- Renamed the active package to `superboard_flutterflow` and the public API to
  `SuperBoard*` / `superboard*`.
- Moved Support and realtime onto the canonical `superboard_flutter` client;
  FlutterFlow now provides thin actions over that single implementation.
- Added deprecated aliases for the 35 reviewed VocoStar OpenGrow functions and
  the migration widget surface.
- Added transactional secure-session key mirroring for the v2 rollback window.
