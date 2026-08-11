## 3.0.0

- Renamed the active package to `superboard_flutterflow` and the public API to
  `SuperBoard*` / `superboard*`.
- Merged the complete Support and realtime Messaging implementation into this
  single package.
- Added deprecated aliases for the 35 reviewed VocoStar OpenGrow functions and
  the migration widget surface.
- Added transactional secure-session key mirroring for the v2 rollback window.
- Kept `opengrow_flutterflow_messaging` frozen at 1.3.0; it is not a v3
  dependency and must not be installed with this package.
