# Public routing and application cutover

OpenGrow separates a Worker deployment from ownership of public hostnames. The
target environment owns the decision through `publicRouting`:

- `staged`: deploy and migrate private Workers, Service Bindings, Queues,
  schedules and storage without adding any custom domain;
- `active`: generate the target's declared custom domains. Development may be
  active directly. Production additionally requires a reviewed FlutterFlow
  client release receipt.

New production targets default to `staged`. VocoStar currently remains staged,
so a green `main` workflow cannot replace `api.vocostar.com`,
`file.vocostar.com`, `sdk.vocostar.com`, the Grow dashboard or MCP domain.
`workers.dev` and preview URLs remain disabled in both modes.

## Client convergence receipt

The application snapshot lives in
`config/flutterflow-sources/<application>.json`. Its schema-validated
convergence contract must prove all declared legacy sources absent, all required
OpenGrow authorities present in the generated application runtime and the
declared diagnostic budget respected.

Generate a receipt only from the fresh external export after the verifier is
green:

```bash
npm run flutterflow:source:verify:vocostar -- \
  --source /secure/fresh/app-vocostar-ff

# Equivalent portable CI form; the variable name is derived from the manifest.
OPENGROW_CLIENT_SOURCE_VOCOSTAR=/secure/fresh/app-vocostar-ff \
  npm run flutterflow:source:verify:vocostar

npm run flutterflow:client:release -- generate \
  --manifest config/flutterflow-sources/vocostar.json \
  --source /secure/fresh/app-vocostar-ff \
  > /secure/review/vocostar-client-receipt.json
```

The generated receipt binds:

- application and FlutterFlow project identity;
- exact FlutterFlow commit;
- canonical snapshot and convergence-policy hashes;
- a SHA-256 digest over every source file covered by the convergence rules;
- passed/blocked check counts;
- diagnostic and validation totals;
- issue timestamp.

It contains no source text, token, password, provider secret or environment
value. Review it, add it as
`config/flutterflow-releases/<application>.json`, and verify it independently:

```bash
npm run flutterflow:client:release -- verify \
  --manifest config/flutterflow-sources/vocostar.json \
  --receipt config/flutterflow-releases/vocostar.json \
  --source /secure/fresh/app-vocostar-ff
```

CI can verify the receipt against the committed snapshot without accessing the
external source. A reviewer with the export supplies `--source` to additionally
recompute the complete evidence digest.

## Production activation

After MBZA acceptance, native device certification, provider sandbox tests and
rollback rehearsal:

1. refresh and review the FlutterFlow snapshot;
2. make every convergence check green;
3. generate and review the client receipt;
4. add `productionCutover` to the target with the exact application, snapshot
   and receipt paths;
5. change only that environment from `publicRouting: staged` to `active` in a
   protected pull request;
6. let CI validate the receipt before the read-only domain plan;
7. resolve any `wrong-worker` or `dns-conflict` explicitly during the approved
   cutover window; OpenGrow never deletes or adopts it automatically;
8. deploy the exact reviewed revision with mandatory encrypted D1 backups;
9. verify API, SDK, files, links, dashboard, MCP, queues and all application
   journeys;
10. retain the previous Worker version, legacy service and backups throughout
    the observation window.

The Infrastructure page displays the live release, target, environment and
`publicRouting` mode. Operators can therefore distinguish a healthy private
staging deployment from a publicly active application.

## Rollback

Rollback public routing and Worker code independently from data:

1. restore the previously recorded Worker/custom-domain owner;
2. set `publicRouting` back to `staged` in the follow-up reviewed revision;
3. roll back the FlutterFlow application/library version;
4. preserve immutable Billing events, jobs, queues and migration evidence;
5. restore D1 only when data corruption is proven and the exact encrypted
   backup batch has been verified.

No Chatwoot/OpenChat, legacy Worker, DNS record or storage resource is deleted
as part of routing activation. Those retirements keep their own retention and
rollback gates.
