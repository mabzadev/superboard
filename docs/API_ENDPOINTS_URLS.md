# URL complètes des endpoints SuperBoard

> Relevé historique antérieur à la réorganisation des domaines. Pour les URL canoniques `/v1` et la migration vers `sdk`, `board`, `in` et `api` personnalisé, consultez [le contrat public](PUBLIC_ENDPOINTS.md). Les adresses ci-dessous ne constituent pas la configuration cible actuelle.

Domaines configurés pour la cible `mabza-development`, relevés le 24 septembre 2026 dans `infra/targets/mabza-development.json`. Ces URL sont construites depuis la configuration et les chemins inventoriés ; leur disponibilité distante n’a pas été testée.

| Service | Origine configurée |
| --- | --- |
| site | [https://board.mabza.dev](https://board.mabza.dev) |
| api | [https://api.mabza.dev](https://api.mabza.dev) |
| sdk | [https://sdk.mabza.dev](https://sdk.mabza.dev) |
| auth | [https://auth.mabza.dev](https://auth.mabza.dev) |
| files | [https://files.mabza.dev](https://files.mabza.dev) |
| shortlinks | [https://in.mabza.dev](https://in.mabza.dev) |
| MCP | [https://board.mabza.dev/mcp](https://board.mabza.dev/mcp) |

Le navigateur local utilise `http://127.0.0.1:4321`. La façade API locale utilise le port `8800`. Ces adresses locales ne sont pas des preuves de déploiement des domaines HTTPS.

Les paramètres `:id`, `:projectRef`, etc. restent à remplacer. Les routes internes utilisent ci-dessous `https://api.internal`, l’adresse logique employée par le service binding `API_SERVICE` : ce domaine n’est pas un endpoint public.

## Paramètres FlutterFlow

| Paramètre | Valeur pour les domaines configurés |
| --- | --- |
| `sdkBaseUrl` | `https://sdk.mabza.dev` |
| `experienceApiBaseUrl` | `https://api.mabza.dev/api/v1` |
| `authGatewayBaseUrl` | `https://auth.mabza.dev` |
| `supportUrl` | `https://api.mabza.dev/api/v1/support-client` |
| URL de Flows | `https://api.mabza.dev/api/v1/flows` |

Ces paramètres correspondent à des clients différents. Le SDK ajoute ensuite ses chemins : par exemple `sdkBaseUrl` + `/purchases/v2/offerings`. `projectKey` et `environment` sont des paramètres séparés.

## Inventaire avec domaines


Relevé du 24 septembre 2026, depuis les diagnostics de l’instance locale et le code du dépôt.

## Lire cet inventaire

- Les chemins `/api/v1/...` sont ceux de la façade API. Les routes `/_emdash/...` utilisent le Site EmDash et sa session opérateur.
- Les routes `/internal/...` sont privées et destinées aux services. Elles ne doivent pas être appelées avec une simple clé SDK.
- `:id`, `:projectRef`, `:plugin` et les autres paramètres sont à remplacer. `*` représente une délégation vers un autre routeur, dont les sous-routes ne sont pas toutes développées ici.
- `ALL` indique un routage générique ; cela ne garantit pas que toutes les méthodes sont acceptées par le service destinataire.
- Les alias et anciennes versions sont conservés dans les listes. Une route déclarée peut être indisponible si son plugin, sa configuration ou son fournisseur est absent.
- Ce relevé recense des contrats et des handlers, pas une certification fonctionnelle de chaque endpoint. Les routes générées ne prouvent pas à elles seules leur activation sur une instance.

## Périmètre et sources

| Source | Nombre d’entrées |
| --- | ---: |
| Diagnostic local — Core | 68 |
| Diagnostic local — Authentification | 18 |
| Diagnostic local — Data et fichiers | 28 |
| Diagnostic local — Monétisation | 64 |
| Diagnostic local — Communication | 70 |
| Diagnostic local — Acquisition | 134 |
| Diagnostic local — Support | 54 |
| Diagnostic local — Analytics | 60 |
| Façade API — handlers HTTP enregistrés et délégations | 464 |
| Manifest Gateway généré | 266 |

Les listes se recoupent : ces nombres ne doivent pas être additionnés comme un total d’URLs uniques. Le socle EmDash possède aussi des API CMS ; seules celles référencées par ces contrats SuperBoard figurent ici.

Sources : [façade API](../packages/plugins/superboard-core/api/src/index.ts), [contrat de collecte](CORE_COLLECTION.md), [catalogue des plugins](../scripts/config/superboard-plugin-catalog.json), [manifest généré](../scripts/config/superboard-parity-release.json). Les diagnostics ont été lus via `GET /_emdash/api/superboard/plugins/{pluginId}/diagnostic`.

## Application et SDK

Les routes natives `/api/v1/sdk/...` peuvent également être servies sans ce préfixe sur le domaine SDK configuré. Les versions Purchases v1 et v2 restent distinctes.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://api.mabza.dev/api/v1/analytics/events` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/remote-config/resolve` |
| `POST` | `https://api.mabza.dev/api/v1/app/events` |
| `POST` | `https://api.mabza.dev/api/v1/app/runtime-policy` |
| `POST` | `https://api.mabza.dev/api/v1/collection/events` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/blocks` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/events` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/survey` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/workflows` |
| `GET` | `https://api.mabza.dev/api/v1/flows/ws/sdk/block-updates` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/events` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/resolve` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/events` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/resolve` |
| `GET` | `https://sdk.mabza.dev/.well-known/purchases-jwks.json` |
| `DELETE` | `https://sdk.mabza.dev/account/v1` |
| `POST` | `https://sdk.mabza.dev/add_payment_event` |
| `POST` | `https://sdk.mabza.dev/attribution` |
| `POST` | `https://sdk.mabza.dev/authenticate` |
| `POST` | `https://sdk.mabza.dev/create_link` |
| `GET` | `https://sdk.mabza.dev/custom/v1/jobs` |
| `POST` | `https://sdk.mabza.dev/custom/v1/jobs` |
| `GET` | `https://sdk.mabza.dev/custom/v1/jobs/:jobId` |
| `POST` | `https://sdk.mabza.dev/custom/v1/jobs/:jobId/cancel` |
| `POST` | `https://sdk.mabza.dev/data_for_device` |
| `POST` | `https://sdk.mabza.dev/data_for_device_and_path` |
| `POST` | `https://sdk.mabza.dev/data_for_device_and_url` |
| `GET` | `https://sdk.mabza.dev/device_for_vendor_id` |
| `POST` | `https://sdk.mabza.dev/event` |
| `POST` | `https://sdk.mabza.dev/events` |
| `POST` | `https://sdk.mabza.dev/generate_link` |
| `GET` | `https://sdk.mabza.dev/link/:path` |
| `POST` | `https://sdk.mabza.dev/link_details` |
| `POST` | `https://sdk.mabza.dev/mark_notification_as_read` |
| `GET` | `https://sdk.mabza.dev/metrics_for_link/:path` |
| `GET` | `https://sdk.mabza.dev/metrics_for_project` |
| `GET` | `https://sdk.mabza.dev/notifications` |
| `POST` | `https://sdk.mabza.dev/notifications_for_device` |
| `GET` | `https://sdk.mabza.dev/notifications_to_display_automatically` |
| `GET` | `https://sdk.mabza.dev/number_of_unread_notifications` |
| `POST` | `https://sdk.mabza.dev/purchases/v1/apple/transactions` |
| `GET` | `https://sdk.mabza.dev/purchases/v1/customer-info` |
| `POST` | `https://sdk.mabza.dev/purchases/v1/google/purchases` |
| `POST` | `https://sdk.mabza.dev/purchases/v1/identify` |
| `GET` | `https://sdk.mabza.dev/purchases/v1/offerings` |
| `POST` | `https://sdk.mabza.dev/purchases/v1/restore` |
| `POST` | `https://sdk.mabza.dev/purchases/v1/sync` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/apple/transactions` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/certification/device-results` |
| `GET` | `https://sdk.mabza.dev/purchases/v2/configuration` |
| `GET` | `https://sdk.mabza.dev/purchases/v2/customer-center` |
| `GET` | `https://sdk.mabza.dev/purchases/v2/customer-info` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/events` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/google/purchases` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/identify` |
| `GET` | `https://sdk.mabza.dev/purchases/v2/offerings` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/receipts` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/restore` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/stripe/checkout` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/stripe/portal` |
| `POST` | `https://sdk.mabza.dev/purchases/v2/sync` |
| `GET` | `https://sdk.mabza.dev/purchases/v2/virtual-currencies` |
| `POST` | `https://sdk.mabza.dev/register` |
| `GET` | `https://sdk.mabza.dev/visitor_attributes` |
| `POST` | `https://sdk.mabza.dev/visitor_attributes` |

## Authentification de l’application

Chemins déclarés dans le service Identity et relayés par la façade `/auth/*`. `DELETE /auth/me` est un ancien endpoint refusé : la suppression utilise `DELETE /api/v1/sdk/account/v1`.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://auth.mabza.dev/auth/anonymous` |
| `POST` | `https://auth.mabza.dev/auth/link/:provider` |
| `POST` | `https://auth.mabza.dev/auth/logout` |
| `DELETE` | `https://auth.mabza.dev/auth/me` |
| `GET` | `https://auth.mabza.dev/auth/me` |
| `PATCH` | `https://auth.mabza.dev/auth/me` |
| `GET` | `https://auth.mabza.dev/auth/me/providers` |
| `GET` | `https://auth.mabza.dev/auth/me/sessions` |
| `DELETE` | `https://auth.mabza.dev/auth/me/sessions/:sessionId` |
| `POST` | `https://auth.mabza.dev/auth/refresh` |
| `POST` | `https://auth.mabza.dev/auth/register` |
| `POST` | `https://auth.mabza.dev/auth/request-password-reset` |
| `GET` | `https://auth.mabza.dev/auth/reset-password` |
| `POST` | `https://auth.mabza.dev/auth/reset-password` |
| `POST` | `https://auth.mabza.dev/auth/signin/:provider` |
| `POST` | `https://auth.mabza.dev/auth/signin/password` |
| `POST` | `https://auth.mabza.dev/auth/superboard-token` |
| `GET` | `https://auth.mabza.dev/auth/verify-email` |

## Support côté application

Sous-routes `/v1/...` du Worker Support exposées par `/api/v1/support-client/...`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `https://api.mabza.dev/api/v1/support-client/configuration` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/contact` |
| `PATCH` | `https://api.mabza.dev/api/v1/support-client/contact` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/conversations` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations` |
| `PATCH` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/attachments` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/attachments/:messageId` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/csat` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/labels` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/meetings` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/messages` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/messages` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/read` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/realtime-ticket` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/transcript` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/typing` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/conversations/:conversationId/ws` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/events` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/help-center/:portalSlug/articles/:articleSlug` |
| `POST` | `https://api.mabza.dev/api/v1/support-client/help-center/:portalSlug/articles/:articleSlug/views` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/help-center/:portalSlug/categories` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/help-center/:portalSlug/search` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/inboxes/:inboxId/members` |
| `GET` | `https://api.mabza.dev/api/v1/support-client/proactive-support` |

## Fichiers côté application

Chemins natifs du service Files, notamment sur le domaine fichiers configuré. La façade fournit aussi des alias `/api/v1/app-files`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `https://files.mabza.dev/v1/downloads/:ticket` |
| `GET` | `https://files.mabza.dev/v1/files` |
| `POST` | `https://files.mabza.dev/v1/files` |
| `DELETE` | `https://files.mabza.dev/v1/files/:id` |
| `GET` | `https://files.mabza.dev/v1/files/:id` |
| `GET` | `https://files.mabza.dev/v1/files/:id/content` |

## Plugin — Core

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `GET` | `https://board.mabza.dev/_emdash/api/admin/plugins/superboard-core/settings` |
| `PUT` | `https://board.mabza.dev/_emdash/api/admin/plugins/superboard-core/settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/audit/archives` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/audit/archives` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/audit/ledger` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/audit/ledger/search` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/audit/verify` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.acknowledge_incident` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.approve_consent` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.archive_ledger` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.discard_email_dead_letter` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.invoke_tool` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.publish_gateway_manifest` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.replay_email_dead_letter` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.resolve_incident` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.retry_custom_job` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.revoke_token` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.rotate_access_policy` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.save_sdk_configuration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.test_sdk_configuration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.update_effective_settings` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.update_gateway_route` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.verify_ledger` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.active_gateway_manifest` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.archives` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.effective_settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.gateway_routes` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.incidents` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.ledger` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.ledger_search` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_custom_jobs` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_email_operations` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_status` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.rate_limits` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.runtime_metrics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.sdk_configurations` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.service_health` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.sessions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.settings_versions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.tokens` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.tool_receipts` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/settings/versions` |
| `GET` | `https://api.mabza.dev/api/v1/app/projects/:projectRef/setup/:platform` |
| `PUT` | `https://api.mabza.dev/api/v1/app/projects/:projectRef/setup/:platform` |
| `POST` | `https://api.mabza.dev/api/v1/app/projects/:projectRef/setup/:platform/test` |
| `POST` | `https://api.mabza.dev/api/v1/gateway/access-policy` |
| `GET` | `https://api.mabza.dev/api/v1/gateway/active-manifest` |
| `POST` | `https://api.mabza.dev/api/v1/gateway/manifests` |
| `GET` | `https://api.mabza.dev/api/v1/gateway/rate-limits` |
| `GET` | `https://api.mabza.dev/api/v1/gateway/routes` |
| `PUT` | `https://api.mabza.dev/api/v1/gateway/routes/:id` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/approve_consent` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/operator/invocations` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/operator/receipts` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/operator/sessions` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/tokens` |
| `DELETE` | `https://api.mabza.dev/api/v1/mcp/tokens/:tokenId` |
| `GET` | `https://api.mabza.dev/api/v1/observability/incidents` |
| `POST` | `https://api.mabza.dev/api/v1/observability/incidents/:incidentId/acknowledge` |
| `POST` | `https://api.mabza.dev/api/v1/observability/incidents/:incidentId/resolve` |
| `GET` | `https://api.mabza.dev/api/v1/observability/runtime-metrics` |
| `GET` | `https://api.mabza.dev/api/v1/observability/service-health` |
| `GET` | `https://api.mabza.dev/api/v1/platform/custom/jobs` |
| `POST` | `https://api.mabza.dev/api/v1/platform/custom/jobs/:jobId/retry` |
| `POST` | `https://api.mabza.dev/api/v1/platform/email/dead-letters/:deadLetterId/discard` |
| `POST` | `https://api.mabza.dev/api/v1/platform/email/dead-letters/:deadLetterId/replay` |
| `GET` | `https://api.mabza.dev/api/v1/platform/email/operations` |
| `GET` | `https://api.mabza.dev/api/v1/platform/status` |

## Plugin — Authentification

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.application_sign_in` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.link_provider` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.revoke_application_session` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.suspend_member` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.update_profile` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.active_sessions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.current_profile` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.linked_providers` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.members` |
| `POST` | `https://api.mabza.dev/api/v1/application-identity/commands/application_sign_in` |
| `POST` | `https://api.mabza.dev/api/v1/application-identity/commands/link_provider` |
| `POST` | `https://api.mabza.dev/api/v1/application-identity/commands/revoke_application_session` |
| `GET` | `https://api.mabza.dev/api/v1/application-identity/data-sources/active_sessions` |
| `GET` | `https://api.mabza.dev/api/v1/application-identity/data-sources/linked_providers` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/members` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `PUT` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `POST` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId/suspend` |

## Plugin — Data et fichiers

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `GET` | `https://board.mabza.dev/_emdash/api/content/:collection` |
| `POST` | `https://board.mabza.dev/_emdash/api/content/:collection` |
| `PUT` | `https://board.mabza.dev/_emdash/api/content/:collection/:id` |
| `POST` | `https://board.mabza.dev/_emdash/api/content/:collection/:id/publish` |
| `GET` | `https://board.mabza.dev/_emdash/api/content/:collection/:id/revisions` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.collect_garbage` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.complete_upload` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.create_document` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.create_upload_ticket` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.delete_object` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.publish_document` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.update_document` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.documents` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.download_ticket` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.object_metadata` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.objects` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.revisions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.storage_usage` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.taxonomies` |
| `GET` | `https://board.mabza.dev/_emdash/api/taxonomies` |
| `POST` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/collect-garbage` |
| `GET` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/objects` |
| `DELETE` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/objects/:id` |
| `GET` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/objects/:id` |
| `GET` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/objects/:id/download-ticket` |
| `POST` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/upload-tickets` |
| `POST` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/upload-tickets/:ticketId/complete` |
| `GET` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/usage` |

## Plugin — Monétisation

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_entitlement` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_offering` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_package` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_product` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_entitlement` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_offering` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_package` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_product` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_purchase` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_refund` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.migrate_products` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.reconcile_store` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.sync_store_catalog` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_entitlement` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_offering` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_package` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_product` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_refund` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_subscription` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.billing_ledger` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.entitlements` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.financial_customer_entitlements` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.migration_status` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.offerings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.packages` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.product_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.products` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.purchase` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.purchases` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.refunds` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.store_sync_runs` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.subscriptions` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/customers/:customerId/entitlements` |
| `POST` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/migrate-products` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/migration/status` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/purchases` |
| `POST` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/purchases` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId/refunds` |
| `POST` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/reconcile` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/refunds` |
| `PUT` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/refunds/:refundId` |
| `GET` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/subscriptions` |
| `PUT` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/subscriptions/:id` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/products` |
| `POST` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/products` |
| `DELETE` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/products/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/products/:id` |
| `POST` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/sync` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/catalog/syncs` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/entitlements` |
| `POST` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/entitlements` |
| `DELETE` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/entitlements/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/entitlements/:id` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/offerings` |
| `POST` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/offerings` |
| `DELETE` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/offerings/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/offerings/:id` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/packages` |
| `POST` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/packages` |
| `DELETE` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/packages/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/packages/:id` |
| `GET` | `https://api.mabza.dev/api/v1/products/projects/:projectRef/statistics` |

## Plugin — Communication

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_email_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_marketing_channel_connector` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_marketing_journey` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_notification` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.delete_marketing_channel_connector` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.delete_smtp_settings` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.discard_dead_letter` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.replay_dead_letter` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.retry_delivery_outbox` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.save_smtp_settings` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.schedule_email_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.send_transactional_email` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.test_smtp_settings` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.transition_email_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.transition_marketing_journey` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_email_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_marketing_channel_connector` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_marketing_journey` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.verify_smtp_domain` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.dead_letters` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.delivery_outbox` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_campaigns` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_subscribers` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_templates` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.journey_enrollments` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.journey_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_channel_connectors` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_journeys` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.notifications` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.provider_events` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.provider_webhooks` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.smtp_settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.subscriber_lists` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.subscriber_segments` |
| `GET` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/provider-events` |
| `GET` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/dead-letters` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/dead-letters/:id/discard` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/dead-letters/:id/replay` |
| `GET` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/delivery-outbox` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/delivery-outbox/:id/retry` |
| `GET` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/provider-webhooks` |
| `GET` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/smtp` |
| `PUT` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/smtp` |
| `DELETE` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/smtp/:id` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/smtp/:profileId/verify-domain` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/settings/smtp/test` |
| `POST` | `https://api.mabza.dev/api/v1/email/projects/:projectRef/transactional` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/campaigns` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/campaigns` |
| `PATCH` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/campaigns/:id` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/campaigns/:id/:transition` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/campaigns/:id/schedule` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/channel-connectors` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/channel-connectors` |
| `DELETE` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/channel-connectors/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/channel-connectors/:id` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/email/subscribers` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys` |
| `PATCH` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys/:id` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys/:id/:transition` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys/:id/enrollments` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/journeys/:id/statistics` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/lists` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/segments` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/statistics` |
| `GET` | `https://api.mabza.dev/api/v1/marketing/projects/:projectRef/templates` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:projectRef/notifications` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:projectRef/notifications/search` |

## Plugin — Acquisition

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.activate_version` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.archive_paywall` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.archive_paywall_experience` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_domain` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_environment` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_link` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_link_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_experience` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_targeting_rule` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_version` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall_experience` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall_version` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_redirect_rule` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_workflow` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_domain` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_link` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_link_campaign` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_onboarding` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_redirect_rule` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_onboarding` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_paywall_version` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_workflow` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.rotate_environment_key` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_localization` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_onboarding_placement` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_paywall_placement` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_social_preview` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_tracking` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.set_onboarding_experience_status` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_link` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_onboarding` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_paywall` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_paywall_experience` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_redirect_rule` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_workflow` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.verify_domain` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.components` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.domains` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.environments` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_campaign_analytics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_campaigns` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.links` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.localization` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_experiences` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_placements` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_targeting_rules` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_versions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboardings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.overview` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_experiences` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_placements` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_statistics` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_versions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywalls` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.redirect_rules` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.resolved_link` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.social_preview` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.tracking` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.user_details` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.users` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.workflow` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.workflows` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/campaign-analytics` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/campaigns` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/campaigns` |
| `DELETE` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/campaigns/:id` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/domains` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/domains` |
| `DELETE` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/domains/:id` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/domains/:id/verify` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/links` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/links` |
| `DELETE` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/links/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/links/:id` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/links/:slug/resolve` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/redirect-rules` |
| `POST` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/redirect-rules` |
| `DELETE` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/social-preview` |
| `PUT` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/social-preview` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/statistics` |
| `GET` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/tracking` |
| `PUT` | `https://api.mabza.dev/api/v1/dynamic-links/projects/:projectRef/tracking` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/components` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/environments` |
| `POST` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/environments` |
| `POST` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/environments/:environmentId/rotate-key` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/localization` |
| `PUT` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/localization` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/overview` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/users` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/users/:userHash` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows` |
| `POST` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows` |
| `GET` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows/:workflowId` |
| `PUT` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows/:workflowId` |
| `POST` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows/:workflowId/publish` |
| `POST` | `https://api.mabza.dev/api/v1/flows/projects/:projectRef/workflows/:workflowId/releases` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef` |
| `DELETE` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/:onboardingId` |
| `PUT` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/:onboardingId` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/:onboardingId/publish` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/:onboardingId/versions` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/:onboardingId/versions` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/experiences` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/experiences` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/experiences/:experienceId/status` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/placements` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/placements` |
| `PUT` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/placements/:placementId` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/statistics` |
| `GET` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/targeting-rules` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/projects/:projectRef/targeting-rules` |
| `GET` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef` |
| `GET` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/experiences` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/experiences` |
| `DELETE` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/experiences/:experienceId` |
| `PUT` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/experiences/:experienceId` |
| `DELETE` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId` |
| `PUT` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId` |
| `GET` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions/:versionId/publish` |
| `GET` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/placements` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/placements` |
| `PUT` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/placements/:id` |
| `GET` | `https://api.mabza.dev/api/v1/paywalls/projects/:projectRef/statistics` |

## Plugin — Support

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_configuration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_integration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_provider` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_configuration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_integration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_provider` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.publish_support_article` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.revoke_support_webhook_secret` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.rotate_support_webhook_secret` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.send_inbox_message` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_inbox_conversation` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_configuration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_integration` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_provider` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_conversations` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_messages` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_articles` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_assistant_tasks` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_categories` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_channels` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_folders` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_integrations` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_portals` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_providers` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.unified_inbox_items` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/captain/tasks` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/channels` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/conversations` |
| `PATCH` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/conversations/:conversationId` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/conversations/:conversationId/messages` |
| `POST` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/conversations/:conversationId/messages` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/help-center/articles` |
| `POST` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/help-center/articles/:id/publish` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/help-center/categories` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/help-center/folders` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/help-center/portals` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/integrations` |
| `POST` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/integrations` |
| `DELETE` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/integrations/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/integrations/:id` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/items` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/providers` |
| `POST` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/providers` |
| `DELETE` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/providers/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/providers/:id` |
| `GET` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings` |
| `PATCH` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings` |
| `POST` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings/entities` |
| `DELETE` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings/entities/:entityId` |
| `PATCH` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings/entities/:entityId` |
| `DELETE` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret` |
| `PUT` | `https://api.mabza.dev/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret` |

## Plugin — Analytics

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_alert` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_cohort` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_dashboard` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_operation` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_report` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_dashboard` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_report` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.evaluate_analytics_cohort` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_dashboard` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_report` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_settings` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.upsert_analytics_remote_config` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_alerts` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_cohorts` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_crashes` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dashboards` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dimensions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_event_analysis` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_events` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_feedback` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_installations` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_overview` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_profiles` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_purchases` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_remote_config` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_reports` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_retention` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_sessions` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_settings` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_views` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/alerts` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/alerts` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/cohorts` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/cohorts` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/cohorts/:id/evaluate` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/crashes` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/dashboards` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/dashboards` |
| `DELETE` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/dashboards/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/dashboards/:id` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/dimensions` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/events` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/events/analyze` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/feedback` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/installations` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/operations` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/overview` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/profiles` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/purchases` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/remote-config` |
| `PUT` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/remote-config/:key` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/reports` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/reports` |
| `DELETE` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/reports/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/reports/:id` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/retention` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/sessions` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/settings` |
| `PUT` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/settings` |
| `GET` | `https://api.mabza.dev/api/v1/analytics/projects/:projectRef/views` |

## Façade API — registre complet extrait

Registre Hono du code courant, après composition des routeurs. Les middlewares généraux ont été exclus ; les délégations génériques restent indiquées par `ALL`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `https://api.mabza.dev/` |
| `POST` | `https://api.mabza.dev/` |
| `GET` | `https://api.mabza.dev/*` |
| `GET` | `https://api.mabza.dev/.well-known/apple-app-site-association` |
| `GET` | `https://api.mabza.dev/.well-known/assetlinks.json` |
| `GET` | `https://api.mabza.dev/.well-known/jwks.json` |
| `GET` | `https://api.mabza.dev/.well-known/oauth-authorization-server` |
| `GET` | `https://api.mabza.dev/.well-known/oauth-protected-resource` |
| `GET` | `https://api.mabza.dev/.well-known/purchases-jwks.json` |
| `GET` | `https://api.mabza.dev/:code` |
| `POST` | `https://api.mabza.dev/api/v1/admin/billing/rewrap_credentials` |
| `POST` | `https://api.mabza.dev/api/v1/admin/flush_events` |
| `POST` | `https://api.mabza.dev/api/v1/admin/migrate_firebase_links` |
| `GET` | `https://api.mabza.dev/api/v1/admin/module-cutover/flows-routing/:projectRef` |
| `PUT` | `https://api.mabza.dev/api/v1/admin/module-cutover/flows-routing/:projectRef` |
| `GET` | `https://api.mabza.dev/api/v1/admin/module-cutover/maintenance/:projectRef` |
| `PUT` | `https://api.mabza.dev/api/v1/admin/module-cutover/maintenance/:projectRef` |
| `POST` | `https://api.mabza.dev/api/v1/admin/module-cutover/user-hashes/:projectRef` |
| `ALL` | `https://api.mabza.dev/api/v1/analytics` |
| `ALL` | `https://api.mabza.dev/api/v1/analytics/*` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/events` |
| `POST` | `https://api.mabza.dev/api/v1/analytics/remote-config/resolve` |
| `ALL` | `https://api.mabza.dev/api/v1/app` |
| `ALL` | `https://api.mabza.dev/api/v1/app-files` |
| `ALL` | `https://api.mabza.dev/api/v1/app-files/*` |
| `ALL` | `https://api.mabza.dev/api/v1/app/*` |
| `POST` | `https://api.mabza.dev/api/v1/app/events` |
| `POST` | `https://api.mabza.dev/api/v1/app/runtime-policy` |
| `ALL` | `https://api.mabza.dev/api/v1/application-identity/:kind/:id` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/members` |
| `ALL` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `POST` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId/resume` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId/security` |
| `POST` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId/sessions/:sessionId/revoke` |
| `POST` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/profiles/:userId/suspend` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/users` |
| `GET` | `https://api.mabza.dev/api/v1/application-users/projects/:projectRef/users/:userId` |
| `GET` | `https://api.mabza.dev/api/v1/auth/me` |
| `POST` | `https://api.mabza.dev/api/v1/auth/sign_in` |
| `POST` | `https://api.mabza.dev/api/v1/auth/sign_up` |
| `POST` | `https://api.mabza.dev/api/v1/automation/details_for_link` |
| `POST` | `https://api.mabza.dev/api/v1/automation/metrics_for_user` |
| `POST` | `https://api.mabza.dev/api/v1/automation/run_maintenance` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/credentials/test` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/customers` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/customers/:customerId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/customers/:customerId/block` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/customers/:customerId/merge` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/entitlements` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/entitlements` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/entitlements/:entitlementId/products` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/entitlements/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/billing/:projectId/entitlements/:id` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/mirror` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/mirror/compare` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings/:id` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings/:offeringId/packages` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings/:offeringId/packages/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/billing/:projectId/offerings/:offeringId/packages/:id` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/oidc` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/oidc` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/products` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/products` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/products/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/billing/:projectId/products/:id` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/products/:productId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/products/sync` |
| `PUT` | `https://api.mabza.dev/api/v1/billing/:projectId/settings` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/stripe` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/stripe` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/stripe/sync` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/stripe/test` |
| `GET` | `https://api.mabza.dev/api/v1/billing/:projectId/webhooks` |
| `POST` | `https://api.mabza.dev/api/v1/billing/:projectId/webhooks` |
| `DELETE` | `https://api.mabza.dev/api/v1/billing/:projectId/webhooks/:id` |
| `ALL` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger` |
| `ALL` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/:rest{.+}` |
| `POST` | `https://api.mabza.dev/api/v1/billing/projects/:projectRef/ledger/migrate-products` |
| `POST` | `https://api.mabza.dev/api/v1/collection/events` |
| `GET` | `https://api.mabza.dev/api/v1/diagnostics/test_diagnostics` |
| `POST` | `https://api.mabza.dev/api/v1/diagnostics/test_diagnostics` |
| `GET` | `https://api.mabza.dev/api/v1/diagnostics/test_exception` |
| `POST` | `https://api.mabza.dev/api/v1/diagnostics/test_exception` |
| `GET` | `https://api.mabza.dev/api/v1/diagnostics/test_logs` |
| `POST` | `https://api.mabza.dev/api/v1/diagnostics/test_logs` |
| `ALL` | `https://api.mabza.dev/api/v1/dynamic-links` |
| `ALL` | `https://api.mabza.dev/api/v1/dynamic-links/*` |
| `ALL` | `https://api.mabza.dev/api/v1/email` |
| `ALL` | `https://api.mabza.dev/api/v1/email/*` |
| `POST` | `https://api.mabza.dev/api/v1/email/aws-ses/events` |
| `POST` | `https://api.mabza.dev/api/v1/email/provider-webhooks/:endpointId` |
| `ALL` | `https://api.mabza.dev/api/v1/files/projects/:projectRef/:rest{.+}` |
| `ALL` | `https://api.mabza.dev/api/v1/flows` |
| `ALL` | `https://api.mabza.dev/api/v1/flows/*` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/blocks` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/events` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/survey` |
| `POST` | `https://api.mabza.dev/api/v1/flows/v2/sdk/workflows` |
| `GET` | `https://api.mabza.dev/api/v1/flows/ws/sdk/block-updates` |
| `ALL` | `https://api.mabza.dev/api/v1/gateway/:rest{.+}` |
| `POST` | `https://api.mabza.dev/api/v1/iap/apple/production/:path` |
| `POST` | `https://api.mabza.dev/api/v1/iap/apple/test/:path` |
| `POST` | `https://api.mabza.dev/api/v1/iap/google/:path` |
| `POST` | `https://api.mabza.dev/api/v1/iap/reconcile_subscriptions` |
| `ALL` | `https://api.mabza.dev/api/v1/identity-admin/projects/:projectRef` |
| `ALL` | `https://api.mabza.dev/api/v1/identity-admin/projects/:projectRef/:rest{.+}` |
| `POST` | `https://api.mabza.dev/api/v1/identity/sso/auth/:provider` |
| `GET` | `https://api.mabza.dev/api/v1/identity/sso/auth/:provider/callback` |
| `POST` | `https://api.mabza.dev/api/v1/identity/sso/auth/:provider/callback` |
| `GET` | `https://api.mabza.dev/api/v1/identity/sso/auth/failure` |
| `POST` | `https://api.mabza.dev/api/v1/identity/sso/tokens/refresh` |
| `GET` | `https://api.mabza.dev/api/v1/instances` |
| `POST` | `https://api.mabza.dev/api/v1/instances` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android/api_access_key` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android/google_configuration_script` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android/push` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/android/push` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id/configurations/desktop` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/desktop` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/desktop` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios/api_access_key` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios/push` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/ios/push` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id/configurations/web` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/configurations/web` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/configurations/web` |
| `POST` | `https://api.mabza.dev/api/v1/instances/:id/dismiss_get_started` |
| `POST` | `https://api.mabza.dev/api/v1/instances/:id/events/billing` |
| `POST` | `https://api.mabza.dev/api/v1/instances/:id/exports/usage` |
| `DELETE` | `https://api.mabza.dev/api/v1/instances/:id/members` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/members` |
| `POST` | `https://api.mabza.dev/api/v1/instances/:id/members` |
| `PUT` | `https://api.mabza.dev/api/v1/instances/:id/revenue_collection` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/role` |
| `GET` | `https://api.mabza.dev/api/v1/instances/:id/setup_progress` |
| `POST` | `https://api.mabza.dev/api/v1/instances/:id/setup_progress/complete` |
| `GET` | `https://api.mabza.dev/api/v1/links` |
| `POST` | `https://api.mabza.dev/api/v1/links` |
| `DELETE` | `https://api.mabza.dev/api/v1/links/:id` |
| `GET` | `https://api.mabza.dev/api/v1/links/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/links/:id` |
| `ALL` | `https://api.mabza.dev/api/v1/marketing` |
| `ALL` | `https://api.mabza.dev/api/v1/marketing/*` |
| `ALL` | `https://api.mabza.dev/api/v1/marketing/opt-in/:token` |
| `POST` | `https://api.mabza.dev/api/v1/marketing/provider-webhooks/:endpointId` |
| `ALL` | `https://api.mabza.dev/api/v1/marketing/tracking/:action/:token` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/analytics/link` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/analytics/overview` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/analytics/top_links` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/approve_consent` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/campaigns` |
| `DELETE` | `https://api.mabza.dev/api/v1/mcp/campaigns/:campaignId` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/campaigns/search` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/consent-request` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/links` |
| `DELETE` | `https://api.mabza.dev/api/v1/mcp/links/:id` |
| `PATCH` | `https://api.mabza.dev/api/v1/mcp/links/:id` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/links/by-path/:path` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/links/search` |
| `ALL` | `https://api.mabza.dev/api/v1/mcp/operator/*` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/platform-status` |
| `POST` | `https://api.mabza.dev/api/v1/mcp/projects` |
| `PUT` | `https://api.mabza.dev/api/v1/mcp/redirects` |
| `PUT` | `https://api.mabza.dev/api/v1/mcp/sdk` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/status` |
| `DELETE` | `https://api.mabza.dev/api/v1/mcp/token` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/tokens` |
| `DELETE` | `https://api.mabza.dev/api/v1/mcp/tokens/:tokenId` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/usage` |
| `GET` | `https://api.mabza.dev/api/v1/mcp/validate` |
| `ALL` | `https://api.mabza.dev/api/v1/observability/*` |
| `ALL` | `https://api.mabza.dev/api/v1/onboardings` |
| `ALL` | `https://api.mabza.dev/api/v1/onboardings/*` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/events` |
| `POST` | `https://api.mabza.dev/api/v1/onboardings/resolve` |
| `ALL` | `https://api.mabza.dev/api/v1/paywalls` |
| `ALL` | `https://api.mabza.dev/api/v1/paywalls/*` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/events` |
| `POST` | `https://api.mabza.dev/api/v1/paywalls/resolve` |
| `GET` | `https://api.mabza.dev/api/v1/platform/account-erasures` |
| `GET` | `https://api.mabza.dev/api/v1/platform/custom/jobs` |
| `GET` | `https://api.mabza.dev/api/v1/platform/custom/jobs/:jobId` |
| `POST` | `https://api.mabza.dev/api/v1/platform/custom/jobs/:jobId/retry` |
| `GET` | `https://api.mabza.dev/api/v1/platform/custom/stats` |
| `POST` | `https://api.mabza.dev/api/v1/platform/email/dead-letters/:deadLetterId/discard` |
| `POST` | `https://api.mabza.dev/api/v1/platform/email/dead-letters/:deadLetterId/replay` |
| `GET` | `https://api.mabza.dev/api/v1/platform/email/operations` |
| `GET` | `https://api.mabza.dev/api/v1/platform/libraries` |
| `GET` | `https://api.mabza.dev/api/v1/platform/status` |
| `ALL` | `https://api.mabza.dev/api/v1/plugins/:plugin/projects/:projectRef/*` |
| `ALL` | `https://api.mabza.dev/api/v1/products` |
| `ALL` | `https://api.mabza.dev/api/v1/products/*` |
| `POST` | `https://api.mabza.dev/api/v1/products/offerings/resolve` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/campaigns` |
| `DELETE` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/:campaignId` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/:campaignId` |
| `PATCH` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/:campaignId` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/metrics_overview` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/search` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/campaigns/search_v2` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/dashboard/links_views` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/dashboard/metrics_overview` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/dashboard/top_links` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/domain` |
| `PUT` | `https://api.mabza.dev/api/v1/projects/:id/domain` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/domain/check_availability` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/domain/defaults` |
| `PUT` | `https://api.mabza.dev/api/v1/projects/:id/domain/google_tracking_id` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/events/metric_values` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/events/overview` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/events/search` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/events/sorted` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/exports/links` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/links` |
| `DELETE` | `https://api.mabza.dev/api/v1/projects/:id/links/:linkId` |
| `PATCH` | `https://api.mabza.dev/api/v1/projects/:id/links/:linkId` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/links/by_ids` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/links/check_path` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/links/random_path` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/links/search` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/links/search_v2` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/notifications` |
| `DELETE` | `https://api.mabza.dev/api/v1/projects/:id/notifications/:notifId` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/notifications/:notifId` |
| `PATCH` | `https://api.mabza.dev/api/v1/projects/:id/notifications/:notifId` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/notifications/:notifId/publish` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/notifications/search` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/purchases/revenue` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/purchases/search` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/redirect_config` |
| `PUT` | `https://api.mabza.dev/api/v1/projects/:id/redirect_config` |
| `PUT` | `https://api.mabza.dev/api/v1/projects/:id/redirect_config/redirect` |
| `GET` | `https://api.mabza.dev/api/v1/projects/:id/visitors/:visitorId` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/visitors/aggregated` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/visitors/aggregated_metrics` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/visitors/metrics` |
| `POST` | `https://api.mabza.dev/api/v1/projects/:id/visitors/search` |
| `POST` | `https://api.mabza.dev/api/v1/projects/add_event` |
| `GET` | `https://api.mabza.dev/api/v1/projects/exports/:fileKey` |
| `POST` | `https://api.mabza.dev/api/v1/push/process` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/.well-known/purchases-jwks.json` |
| `DELETE` | `https://api.mabza.dev/api/v1/sdk/account/v1` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/add_payment_event` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/attribution` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/authenticate` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/create_link` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/custom/v1/jobs` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/custom/v1/jobs` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/custom/v1/jobs/:jobId` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/custom/v1/jobs/:jobId/cancel` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/data_for_device` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/data_for_device_and_path` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/data_for_device_and_url` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/device_for_vendor_id` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/event` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/events` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/generate_link` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/link/:path` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/link_details` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/mark_notification_as_read` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/metrics_for_link/:path` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/metrics_for_project` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/notifications` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/notifications_for_device` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/notifications_to_display_automatically` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/number_of_unread_notifications` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/apple/transactions` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/customer-info` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/google/purchases` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/identify` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/offerings` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/restore` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v1/sync` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/apple/transactions` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/certification/device-results` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/configuration` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/customer-center` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/customer-info` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/events` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/google/purchases` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/identify` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/offerings` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/receipts` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/restore` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/stripe/checkout` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/stripe/portal` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/sync` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/purchases/v2/virtual-currencies` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/register` |
| `GET` | `https://api.mabza.dev/api/v1/sdk/visitor_attributes` |
| `POST` | `https://api.mabza.dev/api/v1/sdk/visitor_attributes` |
| `ALL` | `https://api.mabza.dev/api/v1/support` |
| `ALL` | `https://api.mabza.dev/api/v1/support-client` |
| `ALL` | `https://api.mabza.dev/api/v1/support-client/*` |
| `ALL` | `https://api.mabza.dev/api/v1/support-widget` |
| `ALL` | `https://api.mabza.dev/api/v1/support-widget/*` |
| `ALL` | `https://api.mabza.dev/api/v1/support/*` |
| `ALL` | `https://api.mabza.dev/api/v1/support/help-center` |
| `ALL` | `https://api.mabza.dev/api/v1/support/help-center/*` |
| `GET` | `https://api.mabza.dev/api/v1/support/providers/:provider/:endpointId/events` |
| `POST` | `https://api.mabza.dev/api/v1/support/providers/:provider/:endpointId/events` |
| `GET` | `https://api.mabza.dev/api/v1/support/providers/:provider/oauth/callback` |
| `GET` | `https://api.mabza.dev/api/v1/support/realtime/:ticket` |
| `POST` | `https://api.mabza.dev/api/v1/users` |
| `POST` | `https://api.mabza.dev/api/v1/users/accept_invite` |
| `POST` | `https://api.mabza.dev/api/v1/users/change_password` |
| `DELETE` | `https://api.mabza.dev/api/v1/users/me` |
| `GET` | `https://api.mabza.dev/api/v1/users/me` |
| `PATCH` | `https://api.mabza.dev/api/v1/users/me` |
| `GET` | `https://api.mabza.dev/api/v1/users/me/otp_qr` |
| `PUT` | `https://api.mabza.dev/api/v1/users/me/two_factor` |
| `POST` | `https://api.mabza.dev/api/v1/users/otp_status` |
| `POST` | `https://api.mabza.dev/api/v1/users/reset_password` |
| `GET` | `https://api.mabza.dev/api/v2/inbox/projects/:projectId/items` |
| `ALL` | `https://api.mabza.dev/api/v2/messaging/projects/:projectId/*` |
| `POST` | `https://api.mabza.dev/api/v2/messaging/projects/:projectId/conversations/:conversationId/realtime-ticket` |
| `GET` | `https://api.mabza.dev/api/v2/messaging/projects/:projectId/conversations/:conversationId/ws` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/analytics` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/apple-server-notifications` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/apple-server-notifications/configure` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/audiences` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/audiences` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/certification-runs` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/certification-runs` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/certification-runs/:runId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/certification-runs/:runId/device-challenge` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/certification-runs/:runId/observations` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/connections` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/connections` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/connections/:provider/test` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/credentials/test` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId/block` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId/merge` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/customers/:customerId/virtual-currencies/adjust` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/dead-letters` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/dead-letters/:deadLetterId/discard` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/dead-letters/:deadLetterId/replay` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/entitlements` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/entitlements` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/entitlements/:entitlementId/products` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/entitlements/:id` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/entitlements/:id` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/events` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/experiments` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/experiments` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/experiments/:id` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/exports` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/exports` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/exports/:id/download` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/features` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/features` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/health` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/integrations/deliveries` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/integrations/deliveries/:id/replay` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/connection` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/connection-test` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/connections` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory-runs` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory-runs/:runId/cancel` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/mirror` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/mirror/compare` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings/:id` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings/:id` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages/:id` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages/:id` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/oidc` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/oidc` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywall-event-types` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywalls` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywalls` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywalls/:id/publish` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywalls/:id/versions` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/paywalls/:id/versions` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/placements` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/placements` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/placements/:id` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products/:id` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products/:id` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products/:productId/entitlements/:entitlementId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/products/sync` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/provider-events` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/provider-events/:eventId/replay` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId/actions` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId/actions/:actionId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId/actions/:actionId/approve` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId/evidence` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/refunds/:caseId/evidence/:evidenceId/review` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/release-gate` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/release-gate/checks/:checkKey` |
| `PUT` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/settings` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/stripe` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/stripe` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/stripe/sync` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/stripe/test` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/subscriptions` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/targeting` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/targeting` |
| `PATCH` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/targeting/:id` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/transactions` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/virtual-currencies` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/virtual-currencies` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/virtual-currencies/:currencyId/products/:productId` |
| `GET` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/webhooks` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/webhooks` |
| `DELETE` | `https://api.mabza.dev/api/v2/purchases/projects/:projectId/webhooks/:id` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/providers/webhooks/apple/:environment/:projectId` |
| `POST` | `https://api.mabza.dev/api/v2/purchases/providers/webhooks/stripe/:environment/:projectId` |
| `ALL` | `https://api.mabza.dev/auth` |
| `ALL` | `https://api.mabza.dev/auth/*` |
| `GET` | `https://api.mabza.dev/authorize` |
| `POST` | `https://api.mabza.dev/create` |
| `GET` | `https://api.mabza.dev/favicon.ico` |
| `GET` | `https://api.mabza.dev/health` |
| `GET` | `https://api.mabza.dev/health/billing` |
| `ALL` | `https://api.internal/internal/billing/catalog-ledger` |
| `ALL` | `https://api.internal/internal/billing/catalog-ledger/:rest{.+}` |
| `GET` | `https://api.internal/internal/collection/v1/:plugin/events` |
| `GET` | `https://api.internal/internal/collection/v1/:plugin/projects` |
| `POST` | `https://api.internal/internal/observability/observations` |
| `POST` | `https://api.internal/internal/plugin-tasks` |
| `POST` | `https://api.internal/internal/plugin-tasks/wake` |
| `ALL` | `https://api.internal/internal/site-operator/project-scope` |
| `GET` | `https://api.internal/internal/site/deployment-configuration` |
| `GET` | `https://api.internal/internal/site/plugin-health/:pluginId` |
| `POST` | `https://api.internal/internal/v1/push/support-notifications` |
| `GET` | `https://api.mabza.dev/mm/*` |
| `GET` | `https://api.mabza.dev/mm/:id` |
| `GET` | `https://api.mabza.dev/oauth/api/v1/me` |
| `POST` | `https://api.mabza.dev/oauth/revoke` |
| `POST` | `https://api.mabza.dev/oauth/token` |
| `GET` | `https://api.mabza.dev/oauth/token/info` |
| `GET` | `https://api.mabza.dev/public` |
| `GET` | `https://api.mabza.dev/quick-link-assets/*` |
| `POST` | `https://api.mabza.dev/register` |
| `POST` | `https://api.mabza.dev/token` |
| `GET` | `https://api.mabza.dev/up` |

## Manifest Gateway généré

| Méthode | Chemin | Destination | Authentification |
| --- | --- | --- | --- |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-audit/health` | `superboard-audit` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-audit/commands/superboard-audit.command.archive_ledger` | `superboard-audit` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-audit/commands/superboard-audit.command.verify_ledger` | `superboard-audit` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.archives` | `superboard-audit` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.ledger` | `superboard-audit` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.ledger_search` | `superboard-audit` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-content/health` | `superboard-content` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.create_document` | `superboard-content` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.publish_document` | `superboard-content` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.update_document` | `superboard-content` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.documents` | `superboard-content` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.revisions` | `superboard-content` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.taxonomies` | `superboard-content` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-products/health` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_offering` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_package` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_product` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_offering` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_package` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_product` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.sync_store_catalog` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_offering` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_package` | `superboard-products` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_product` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.entitlements` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.offerings` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.packages` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.product_statistics` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.products` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.store_sync_runs` | `superboard-products` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-settings/health` | `superboard-settings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.save_sdk_configuration` | `superboard-settings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.test_sdk_configuration` | `superboard-settings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.update_effective_settings` | `superboard-settings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.effective_settings` | `superboard-settings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.sdk_configurations` | `superboard-settings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.settings_versions` | `superboard-settings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-user/health` | `superboard-user` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.application_sign_in` | `superboard-user` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.link_provider` | `superboard-user` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.revoke_application_session` | `superboard-user` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.suspend_member` | `superboard-user` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.update_profile` | `superboard-user` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.active_sessions` | `superboard-user` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.current_profile` | `superboard-user` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.linked_providers` | `superboard-user` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.members` | `superboard-user` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-analytics/health` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_alert` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_cohort` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_operation` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.evaluate_analytics_cohort` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_settings` | `superboard-analytics` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.upsert_analytics_remote_config` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_alerts` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_cohorts` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_crashes` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dashboards` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dimensions` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_event_analysis` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_events` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_feedback` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_installations` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_overview` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_profiles` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_purchases` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_remote_config` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_reports` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_retention` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_sessions` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_settings` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_views` | `superboard-analytics` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-billing/health` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.create_purchase` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.create_refund` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.migrate_products` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.reconcile_store` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.update_refund` | `superboard-billing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.update_subscription` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.billing_ledger` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.financial_customer_entitlements` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.migration_status` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.purchase` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.purchases` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.refunds` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.subscriptions` | `superboard-billing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-dynamic-links/health` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_domain` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_link_campaign` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_domain` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_link_campaign` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.save_social_preview` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.save_tracking` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.update_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.update_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.verify_domain` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.domains` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_campaign_analytics` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_campaigns` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_statistics` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.links` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.redirect_rules` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.resolved_link` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.social_preview` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.tracking` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-email/health` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.delete_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.discard_dead_letter` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.replay_dead_letter` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.retry_delivery_outbox` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.save_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.send_transactional_email` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.test_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.verify_smtp_domain` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.dead_letters` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.delivery_outbox` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.provider_events` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.provider_webhooks` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.smtp_settings` | `superboard-email` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-files/health` | `superboard-files` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.collect_garbage` | `superboard-files` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.complete_upload` | `superboard-files` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.create_upload_ticket` | `superboard-files` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.delete_object` | `superboard-files` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.download_ticket` | `superboard-files` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.object_metadata` | `superboard-files` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.objects` | `superboard-files` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.storage_usage` | `superboard-files` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-flows/health` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.activate_version` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.create_environment` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.create_workflow` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.publish_workflow` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.rotate_environment_key` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.save_localization` | `superboard-flows` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.update_workflow` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.components` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.environments` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.localization` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.overview` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.user_details` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.users` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.workflow` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.workflows` | `superboard-flows` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-gateway/health` | `superboard-gateway` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.publish_gateway_manifest` | `superboard-gateway` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.rotate_access_policy` | `superboard-gateway` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.update_gateway_route` | `superboard-gateway` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.active_gateway_manifest` | `superboard-gateway` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.gateway_routes` | `superboard-gateway` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.rate_limits` | `superboard-gateway` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-marketing/health` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_marketing_journey` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_notification` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.delete_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.schedule_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.transition_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.transition_marketing_journey` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_marketing_journey` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_campaigns` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_subscribers` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_templates` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.journey_enrollments` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.journey_statistics` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_channel_connectors` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_journeys` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_statistics` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.notifications` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.subscriber_lists` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.subscriber_segments` | `superboard-marketing` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-mcp/health` | `superboard-mcp` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.approve_consent` | `superboard-mcp` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.invoke_tool` | `superboard-mcp` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.revoke_token` | `superboard-mcp` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.sessions` | `superboard-mcp` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.tokens` | `superboard-mcp` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.tool_receipts` | `superboard-mcp` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-observability/health` | `superboard-observability` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.acknowledge_incident` | `superboard-observability` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.discard_email_dead_letter` | `superboard-observability` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.replay_email_dead_letter` | `superboard-observability` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.resolve_incident` | `superboard-observability` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.retry_custom_job` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.incidents` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_custom_jobs` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_email_operations` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_status` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.runtime_metrics` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.service_health` | `superboard-observability` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-onboardings/health` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_experience` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_targeting_rule` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_version` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.delete_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.publish_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.save_onboarding_placement` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.set_onboarding_experience_status` | `superboard-onboardings` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.update_onboarding` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_experiences` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_placements` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_statistics` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_targeting_rules` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_versions` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboardings` | `superboard-onboardings` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-paywalls/health` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.archive_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.archive_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall_version` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.publish_paywall_version` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.save_paywall_placement` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.update_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.update_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_experiences` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_placements` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_statistics` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_versions` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywalls` | `superboard-paywalls` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/plugins/superboard-support/health` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.publish_support_article` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.revoke_support_webhook_secret` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.rotate_support_webhook_secret` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.send_inbox_message` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_inbox_conversation` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_settings` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_conversations` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_messages` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_articles` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_assistant_tasks` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_categories` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_channels` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_folders` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_integrations` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_portals` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_providers` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_settings` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.unified_inbox_items` | `superboard-support` | `authenticated` |
| `GET` | `https://board.mabza.dev/superboard-system/health` | `superboard-site` | `public` |
