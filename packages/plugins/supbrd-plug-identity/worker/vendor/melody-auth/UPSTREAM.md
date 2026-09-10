# Melody Auth integration provenance

The Identity engine imports the Melody Auth server, hosted views, feature
contract, and SDK behavior from `ValueMelody/melody-auth` at immutable commit
`a08f1d44a77e5aeee1a2368aaf96931259a83a27` (upstream version `1.3.8`).

SuperBoard keeps the upstream route and interaction contracts while replacing
deployment adapters with Cloudflare-native D1, private Service Bindings,
SuperBoard Email, and the canonical SuperBoard user identity bridge.

The upstream Node-only SAML adapter is replaced by the Worker implementation
under `src/melody/saml/`: IdP metadata parsing, redirect binding, signed XML
verification, encrypted assertion decryption, audience/destination/time checks,
and strong D1 replay protection all execute inside the Identity Worker.
