# Plugins

EmDash plugins and SuperBoard extensions live directly in this directory.

| SuperBoard plugin           | Components                                | Service packages                      |
| --------------------------- | ----------------------------------------- | ------------------------------------- |
| `supbrd-core`               | Settings, audit, gateway, monitoring, MCP | `api`, `app`, `observability`, `mcp`  |
| `supbrd-plug-identity`      | User and application identity             | `worker`                              |
| `supbrd-plug-data`          | Content and files                         | `worker`                              |
| `supbrd-plug-commerce`      | Products, billing, paywalls               | `products`, `billing`, `paywalls`     |
| `supbrd-plug-communication` | Marketing, email, dynamic links           | `marketing`, `email`, `dynamic-links` |
| `supbrd-plug-journeys`      | Onboardings and Flows                     | `onboardings`, `flows`                |
| `supbrd-plug-support`       | Support                                   | `worker`                              |
| `supbrd-plug-analytics`     | Analytics                                 | `worker`                              |

Each SuperBoard plugin owns its Front sources under `src/front`, its EmDash
entrypoint and its service packages. Services keep their tests and migrations.
Shared browser components live in `../supbrd-front-ui`; shared runtime helpers
live in `../supbrd-core`. The Site assembles plugin contributions.

SuperBoard extensions use the integration supplied by this repository. Moving
them into this directory does not make them standalone marketplace plugins.
The existing EmDash plugins keep their own package formats and entrypoints.

See [the monorepo guide](../../docs/MONOREPO.md) for build commands and
[service ownership](WORKERS.md) for deployment groups.
