# SuperBoard Flows web SDK

The web SDK is imported from two pinned upstream commits through
`scripts/sync-flows-upstream.mjs`. Runtime packages live under `upstream/packages` and use the
`@superboard` namespace:

- `@superboard/flows-js`
- `@superboard/flows-react`
- `@superboard/flows-js-components`
- `@superboard/flows-react-components`
- `@superboard/flows-shared`
- `@superboard/flows-styles`

Their source state is governed by `config/sdk-libraries.json` schema v5. The four consumable SDKs
are initially `unreleased`: no npm artifact, immutable tag, release ref, release SHA or install
command is claimed before a real first publication. `flows-shared` and `flows-styles` are private
workspace dependencies bundled by the public SDK builds, so the catalogue marks them
`workspace-only` instead of presenting them as standalone packages.

The JavaScript and React SDKs use the same-origin `/api/v1/flows` endpoint by default. Consumers
can still pass `apiUrl` to use a custom SuperBoard gateway. No package makes a runtime request to
the upstream Flows service.

Every native Flows request is authenticated with the rotatable key of the selected environment.
The SuperBoard JavaScript and React packages accept `sdkKey`; the shared transport adds
`x-superboard-flows-sdk-key` to HTTP calls and the WebSocket connector uses the matching query
credential. The key is never placed in event payloads or the persisted retry queue.
Browser WebSocket constructors cannot attach a custom authentication header, so realtime uses the
`sdkKey` query parameter over WSS. Environment SDK keys are public, client-embedded, rotatable
credentials rather than server secrets. SDK debug output prints only the WebSocket path; operators
must likewise avoid persisting full WebSocket URLs in custom proxies or client telemetry.

SuperBoard packages identify the tenant directly with the SuperBoard `projectId`; Flows has no
second tenant identifier or compatibility alias. A host-provided `customFetch` may inject
`x-superboard-flows-sdk-key`. The Worker resolves the project and exact environment, then compares
the SHA-256 key hash in constant time. A project or environment identifier without a credential is
always rejected.

## `superboard-commerce` web extension point

Both web renderers preserve the public custom-component registry, so applications register their
Products-backed renderer under the exact `superboard-commerce` key:

```tsx
<FlowsProvider
  components={{
    ...components,
    "superboard-commerce": SuperBoardCommerce,
  }}
  tourComponents={tourComponents}
  surveyComponents={surveyComponents}
  {...flowsConfiguration}
>
  {children}
</FlowsProvider>
```

The JavaScript wrapper accepts the same key through
`setupJsComponents({ components, tourComponents, surveyComponents })` and defines the valid custom
element tag `flows-superboard-commerce`.

The imported web packages deliberately do not implement checkout themselves: this repository has
no canonical Products web SDK yet. The registered component must delegate offer loading, purchase,
receipt validation and restore to SuperBoard Products/Purchases. It may invoke the action supplied by Flows only
after Products returns an outcome, and must never send price or revenue data to Flows. This keeps
purchase accounting authoritative and prevents duplicate revenue analytics.

## Reproducible synchronization

Prepare clean local clones at the commits recorded in `upstream/manifest.json`, then run:

```sh
node scripts/sync-flows-upstream.mjs \
  --flows-sh-source /path/to/flows.sh \
  --flows-sdk-source /path/to/flows-sdk
```

The command refuses another commit or a dirty source checkout. It stages the complete generated
tree, applies reviewed namespace/runtime adaptations, records source and output SHA-256 hashes,
and swaps the generated tree only after all source files were read successfully.

To verify the checked-in tree without network access or source clones:

```sh
npm --prefix sdks/flows run check:import
```

Add `--verify-sources` and both source arguments to verify the source hashes as well. Product docs,
assets, examples, public types, constants, icons and UI primitives under `upstream/reference` and
`upstream/product` are reference inputs for SuperBoard. They are deliberately outside the runtime
workspace and are never deployed as a second dashboard.
