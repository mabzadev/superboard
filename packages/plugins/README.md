# Plugins

EmDash plugins and SuperBoard extensions live directly in this directory.

| Plugin directory              | Components                                     | Service packages                                    |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `superboard-core`             | Settings, audit, gateway, monitoring, MCP      | `api`, `app`, `observability`, `mcp`                |
| `superboard-authentification` | User and application identity                  | `worker`                                            |
| `superboard-data`             | Content and files                              | `worker`                                            |
| `superboard-monetization`     | Products and billing                           | `products`, `billing`                               |
| `superboard-communication`    | Marketing and email                            | `marketing`, `email`                                |
| `superboard-acquisition`      | Paywalls, onboardings, Flows and dynamic links | `paywalls`, `onboardings`, `flows`, `dynamic-links` |
| `superboard-support`          | Support                                        | `worker`                                            |
| `superboard-analytics`        | Analytics                                      | `worker`                                            |

Each SuperBoard plugin owns its Front sources under `src/front`, its EmDash
entrypoint and its service packages. Services keep their tests and migrations.
Shared browser components live in `../supbrd-front-ui`; shared runtime helpers
live in `../supbrd-core`. The Site assembles plugin contributions.

SuperBoard extensions use the integration supplied by this repository. Moving
them into this directory does not make them standalone marketplace plugins.
The existing EmDash plugins keep their own package formats and entrypoints.

See [the monorepo guide](../../docs/MONOREPO.md) for build commands and
[service ownership](WORKERS.md) for deployment groups.

The directory and display name of each plugin are declared in
`scripts/config/superboard-plugin-packages.json`. Persisted package and component
IDs retain their existing values so settings, lifecycle state and View bindings
remain accessible after directory renames. The front menu groups Views by the
component ownership declared in that file. Core configuration is available
through the Front at `/project-settings`.
