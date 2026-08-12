# SuperBoard Reference security policy

The reference application validates SuperBoard's common FlutterFlow and Flutter
journeys. Security fixes are developed on `dev` and promoted through the
protected workflow.

Report vulnerabilities with GitHub's private vulnerability reporting for
`mabzadev/superboard`. Do not publish credentials, user data, access
tokens or exploit details in a public issue. If private reporting is
unavailable, open a non-sensitive issue requesting a private contact channel.

This repository must contain only public development endpoints. Project keys,
Cloudflare credentials, OAuth secrets and application user tokens belong in
the deployment environment or an ignored local configuration. Compromised
credentials must be rotated before a fix is disclosed.
