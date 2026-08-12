# SuperBoard security policy

## Supported branches

Security fixes are developed and validated on `dev`, then promoted to `main`
through the protected release workflow. Only the current `dev` and `main`
revisions are supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for
`mabzadev/superboard`. Include the affected service or SDK, the impact,
reproduction steps and a proposed mitigation when available. Do not publish
credentials, personal data, exploit details or a working proof of concept in a
public issue.

If private reporting is unavailable, open a public issue containing no
sensitive detail and request a private contact channel. A maintainer will move
the investigation out of the public issue.

## Operational secrets

Cloudflare tokens, account IDs used by CI, OAuth client secrets, signing keys,
SMTP credentials, provider keys and backup encryption keys must be stored in
the declared GitHub Environment or Cloudflare Worker secret. Target manifests
contain only public configuration, resource names and non-secret resource IDs.

Potential disclosures should be rotated before remediation is published. Run
the repository secret scan and the complete validation suite before promoting
the fix.
