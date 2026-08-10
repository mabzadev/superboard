# Contributing to OpenGrow Reference

The `dev` branch tracks the OpenGrow platform `dev` branch and publishes the
MBZA acceptance application. `main` represents the reviewed reference release
and must pin immutable platform SDK tags. Both branches require the aggregate
`Reference gate` and an approving CODEOWNERS review. A platform-triggered
acceptance run rejects any SHA that is not part of the official platform `dev`
history.

Validate a change with:

```bash
npm ci
npm run check
flutter analyze
flutter test
```

The reference repository contains screens, acceptance journeys and UI glue
only. Reusable widgets, custom actions, authentication, files, purchases,
Marketing and Support behavior belong in `opengrow-platform`. Never copy the
network protocol or SDK implementation into this application.

Keep public endpoints in `reference.project.json` and
`config/development.json` synchronized. Never commit a project key, secret,
access token, user export, generated build or machine-specific dependency path.
Use `dart tool/use_local_platform.dart` to create the ignored local override
when testing both repositories together.
