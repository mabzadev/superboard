# FlutterFlow client release receipts

This directory contains reviewed, non-secret receipts proving that an external
FlutterFlow application snapshot satisfies its versioned OpenGrow convergence
contract. A receipt is generated only after the snapshot verifier reports zero
blocked checks:

```bash
npm run flutterflow:client:release -- generate \
  --manifest config/flutterflow-sources/<application>.json \
  --source /absolute/path/to/the/fresh/flutterflow/export
```

Review the JSON output, add it as
`config/flutterflow-releases/<application>.json`, and reference both the
snapshot and receipt from the target's `productionCutover` object. Production
`publicRouting: active` is rejected when the receipt is absent, mismatched or
stale. `publicRouting: staged` deploys private Workers without claiming a
hostname and does not require a receipt.

The receipt contains hashes, relative evidence counts, project metadata and
diagnostic totals. It never contains a FlutterFlow credential, Cloudflare
credential, application token or source content.
