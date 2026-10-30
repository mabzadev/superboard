# Inventaire des endpoints SuperBoard

> Relevé historique antérieur à la réorganisation des domaines. Pour les URL canoniques `/v1` et la migration vers `sdk`, `board`, `in` et `api` personnalisé, consultez [le contrat public](PUBLIC_ENDPOINTS.md). Les adresses ci-dessous ne constituent pas la configuration cible actuelle.

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
| `POST` | `/api/v1/analytics/events` |
| `POST` | `/api/v1/analytics/remote-config/resolve` |
| `POST` | `/api/v1/app/events` |
| `POST` | `/api/v1/app/runtime-policy` |
| `POST` | `/api/v1/collection/events` |
| `POST` | `/api/v1/flows/v2/sdk/blocks` |
| `POST` | `/api/v1/flows/v2/sdk/events` |
| `POST` | `/api/v1/flows/v2/sdk/survey` |
| `POST` | `/api/v1/flows/v2/sdk/workflows` |
| `GET` | `/api/v1/flows/ws/sdk/block-updates` |
| `POST` | `/api/v1/onboardings/events` |
| `POST` | `/api/v1/onboardings/resolve` |
| `POST` | `/api/v1/paywalls/events` |
| `POST` | `/api/v1/paywalls/resolve` |
| `GET` | `/api/v1/sdk/.well-known/purchases-jwks.json` |
| `DELETE` | `/api/v1/sdk/account/v1` |
| `POST` | `/api/v1/sdk/add_payment_event` |
| `POST` | `/api/v1/sdk/attribution` |
| `POST` | `/api/v1/sdk/authenticate` |
| `POST` | `/api/v1/sdk/create_link` |
| `GET` | `/api/v1/sdk/custom/v1/jobs` |
| `POST` | `/api/v1/sdk/custom/v1/jobs` |
| `GET` | `/api/v1/sdk/custom/v1/jobs/:jobId` |
| `POST` | `/api/v1/sdk/custom/v1/jobs/:jobId/cancel` |
| `POST` | `/api/v1/sdk/data_for_device` |
| `POST` | `/api/v1/sdk/data_for_device_and_path` |
| `POST` | `/api/v1/sdk/data_for_device_and_url` |
| `GET` | `/api/v1/sdk/device_for_vendor_id` |
| `POST` | `/api/v1/sdk/event` |
| `POST` | `/api/v1/sdk/events` |
| `POST` | `/api/v1/sdk/generate_link` |
| `GET` | `/api/v1/sdk/link/:path` |
| `POST` | `/api/v1/sdk/link_details` |
| `POST` | `/api/v1/sdk/mark_notification_as_read` |
| `GET` | `/api/v1/sdk/metrics_for_link/:path` |
| `GET` | `/api/v1/sdk/metrics_for_project` |
| `GET` | `/api/v1/sdk/notifications` |
| `POST` | `/api/v1/sdk/notifications_for_device` |
| `GET` | `/api/v1/sdk/notifications_to_display_automatically` |
| `GET` | `/api/v1/sdk/number_of_unread_notifications` |
| `POST` | `/api/v1/sdk/purchases/v1/apple/transactions` |
| `GET` | `/api/v1/sdk/purchases/v1/customer-info` |
| `POST` | `/api/v1/sdk/purchases/v1/google/purchases` |
| `POST` | `/api/v1/sdk/purchases/v1/identify` |
| `GET` | `/api/v1/sdk/purchases/v1/offerings` |
| `POST` | `/api/v1/sdk/purchases/v1/restore` |
| `POST` | `/api/v1/sdk/purchases/v1/sync` |
| `POST` | `/api/v1/sdk/purchases/v2/apple/transactions` |
| `POST` | `/api/v1/sdk/purchases/v2/certification/device-results` |
| `GET` | `/api/v1/sdk/purchases/v2/configuration` |
| `GET` | `/api/v1/sdk/purchases/v2/customer-center` |
| `GET` | `/api/v1/sdk/purchases/v2/customer-info` |
| `POST` | `/api/v1/sdk/purchases/v2/events` |
| `POST` | `/api/v1/sdk/purchases/v2/google/purchases` |
| `POST` | `/api/v1/sdk/purchases/v2/identify` |
| `GET` | `/api/v1/sdk/purchases/v2/offerings` |
| `POST` | `/api/v1/sdk/purchases/v2/receipts` |
| `POST` | `/api/v1/sdk/purchases/v2/restore` |
| `POST` | `/api/v1/sdk/purchases/v2/stripe/checkout` |
| `POST` | `/api/v1/sdk/purchases/v2/stripe/portal` |
| `POST` | `/api/v1/sdk/purchases/v2/sync` |
| `GET` | `/api/v1/sdk/purchases/v2/virtual-currencies` |
| `POST` | `/api/v1/sdk/register` |
| `GET` | `/api/v1/sdk/visitor_attributes` |
| `POST` | `/api/v1/sdk/visitor_attributes` |

## Authentification de l’application

Chemins déclarés dans le service Identity et relayés par la façade `/auth/*`. `DELETE /auth/me` est un ancien endpoint refusé : la suppression utilise `DELETE /api/v1/sdk/account/v1`.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/auth/anonymous` |
| `POST` | `/auth/link/:provider` |
| `POST` | `/auth/logout` |
| `DELETE` | `/auth/me` |
| `GET` | `/auth/me` |
| `PATCH` | `/auth/me` |
| `GET` | `/auth/me/providers` |
| `GET` | `/auth/me/sessions` |
| `DELETE` | `/auth/me/sessions/:sessionId` |
| `POST` | `/auth/refresh` |
| `POST` | `/auth/register` |
| `POST` | `/auth/request-password-reset` |
| `GET` | `/auth/reset-password` |
| `POST` | `/auth/reset-password` |
| `POST` | `/auth/signin/:provider` |
| `POST` | `/auth/signin/password` |
| `POST` | `/auth/superboard-token` |
| `GET` | `/auth/verify-email` |

## Support côté application

Sous-routes `/v1/...` du Worker Support exposées par `/api/v1/support-client/...`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `/api/v1/support-client/configuration` |
| `GET` | `/api/v1/support-client/contact` |
| `PATCH` | `/api/v1/support-client/contact` |
| `GET` | `/api/v1/support-client/conversations` |
| `POST` | `/api/v1/support-client/conversations` |
| `PATCH` | `/api/v1/support-client/conversations/:conversationId` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/attachments` |
| `GET` | `/api/v1/support-client/conversations/:conversationId/attachments/:messageId` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/csat` |
| `GET` | `/api/v1/support-client/conversations/:conversationId/labels` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/meetings` |
| `GET` | `/api/v1/support-client/conversations/:conversationId/messages` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/messages` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/read` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/realtime-ticket` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/transcript` |
| `POST` | `/api/v1/support-client/conversations/:conversationId/typing` |
| `GET` | `/api/v1/support-client/conversations/:conversationId/ws` |
| `POST` | `/api/v1/support-client/events` |
| `GET` | `/api/v1/support-client/help-center/:portalSlug/articles/:articleSlug` |
| `POST` | `/api/v1/support-client/help-center/:portalSlug/articles/:articleSlug/views` |
| `GET` | `/api/v1/support-client/help-center/:portalSlug/categories` |
| `GET` | `/api/v1/support-client/help-center/:portalSlug/search` |
| `GET` | `/api/v1/support-client/inboxes/:inboxId/members` |
| `GET` | `/api/v1/support-client/proactive-support` |

## Fichiers côté application

Chemins natifs du service Files, notamment sur le domaine fichiers configuré. La façade fournit aussi des alias `/api/v1/app-files`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `/v1/downloads/:ticket` |
| `GET` | `/v1/files` |
| `POST` | `/v1/files` |
| `DELETE` | `/v1/files/:id` |
| `GET` | `/v1/files/:id` |
| `GET` | `/v1/files/:id/content` |

## Plugin — Core

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `GET` | `/_emdash/api/admin/plugins/superboard-core/settings` |
| `PUT` | `/_emdash/api/admin/plugins/superboard-core/settings` |
| `GET` | `/_emdash/api/superboard/audit/archives` |
| `POST` | `/_emdash/api/superboard/audit/archives` |
| `GET` | `/_emdash/api/superboard/audit/ledger` |
| `GET` | `/_emdash/api/superboard/audit/ledger/search` |
| `POST` | `/_emdash/api/superboard/audit/verify` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.acknowledge_incident` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.approve_consent` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.archive_ledger` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.discard_email_dead_letter` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.invoke_tool` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.publish_gateway_manifest` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.replay_email_dead_letter` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.resolve_incident` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.retry_custom_job` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.revoke_token` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.rotate_access_policy` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.save_sdk_configuration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.test_sdk_configuration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.update_effective_settings` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.update_gateway_route` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-core/commands/superboard-core.command.verify_ledger` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.active_gateway_manifest` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.archives` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.effective_settings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.gateway_routes` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.incidents` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.ledger` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.ledger_search` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_custom_jobs` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_email_operations` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.platform_status` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.rate_limits` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.runtime_metrics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.sdk_configurations` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.service_health` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.sessions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.settings_versions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.tokens` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-core/data-sources/superboard-core.data_source.tool_receipts` |
| `GET` | `/_emdash/api/superboard/settings/versions` |
| `GET` | `/api/v1/app/projects/:projectRef/setup/:platform` |
| `PUT` | `/api/v1/app/projects/:projectRef/setup/:platform` |
| `POST` | `/api/v1/app/projects/:projectRef/setup/:platform/test` |
| `POST` | `/api/v1/gateway/access-policy` |
| `GET` | `/api/v1/gateway/active-manifest` |
| `POST` | `/api/v1/gateway/manifests` |
| `GET` | `/api/v1/gateway/rate-limits` |
| `GET` | `/api/v1/gateway/routes` |
| `PUT` | `/api/v1/gateway/routes/:id` |
| `POST` | `/api/v1/mcp/approve_consent` |
| `POST` | `/api/v1/mcp/operator/invocations` |
| `GET` | `/api/v1/mcp/operator/receipts` |
| `GET` | `/api/v1/mcp/operator/sessions` |
| `GET` | `/api/v1/mcp/tokens` |
| `DELETE` | `/api/v1/mcp/tokens/:tokenId` |
| `GET` | `/api/v1/observability/incidents` |
| `POST` | `/api/v1/observability/incidents/:incidentId/acknowledge` |
| `POST` | `/api/v1/observability/incidents/:incidentId/resolve` |
| `GET` | `/api/v1/observability/runtime-metrics` |
| `GET` | `/api/v1/observability/service-health` |
| `GET` | `/api/v1/platform/custom/jobs` |
| `POST` | `/api/v1/platform/custom/jobs/:jobId/retry` |
| `POST` | `/api/v1/platform/email/dead-letters/:deadLetterId/discard` |
| `POST` | `/api/v1/platform/email/dead-letters/:deadLetterId/replay` |
| `GET` | `/api/v1/platform/email/operations` |
| `GET` | `/api/v1/platform/status` |

## Plugin — Authentification

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.application_sign_in` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.link_provider` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.revoke_application_session` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.suspend_member` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-authentification/commands/superboard-authentification.command.update_profile` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.active_sessions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.current_profile` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.linked_providers` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-authentification/data-sources/superboard-authentification.data_source.members` |
| `POST` | `/api/v1/application-identity/commands/application_sign_in` |
| `POST` | `/api/v1/application-identity/commands/link_provider` |
| `POST` | `/api/v1/application-identity/commands/revoke_application_session` |
| `GET` | `/api/v1/application-identity/data-sources/active_sessions` |
| `GET` | `/api/v1/application-identity/data-sources/linked_providers` |
| `GET` | `/api/v1/application-users/projects/:projectRef/members` |
| `GET` | `/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `PUT` | `/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `POST` | `/api/v1/application-users/projects/:projectRef/profiles/:userId/suspend` |

## Plugin — Data et fichiers

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `GET` | `/_emdash/api/content/:collection` |
| `POST` | `/_emdash/api/content/:collection` |
| `PUT` | `/_emdash/api/content/:collection/:id` |
| `POST` | `/_emdash/api/content/:collection/:id/publish` |
| `GET` | `/_emdash/api/content/:collection/:id/revisions` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.collect_garbage` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.complete_upload` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.create_document` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.create_upload_ticket` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.delete_object` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.publish_document` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-data/commands/superboard-data.command.update_document` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.documents` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.download_ticket` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.object_metadata` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.objects` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.revisions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.storage_usage` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-data/data-sources/superboard-data.data_source.taxonomies` |
| `GET` | `/_emdash/api/taxonomies` |
| `POST` | `/api/v1/files/projects/:projectRef/collect-garbage` |
| `GET` | `/api/v1/files/projects/:projectRef/objects` |
| `DELETE` | `/api/v1/files/projects/:projectRef/objects/:id` |
| `GET` | `/api/v1/files/projects/:projectRef/objects/:id` |
| `GET` | `/api/v1/files/projects/:projectRef/objects/:id/download-ticket` |
| `POST` | `/api/v1/files/projects/:projectRef/upload-tickets` |
| `POST` | `/api/v1/files/projects/:projectRef/upload-tickets/:ticketId/complete` |
| `GET` | `/api/v1/files/projects/:projectRef/usage` |

## Plugin — Monétisation

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_entitlement` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_offering` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_package` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.archive_product` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_entitlement` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_offering` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_package` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_product` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_purchase` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.create_refund` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.migrate_products` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.reconcile_store` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.sync_store_catalog` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_entitlement` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_offering` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_package` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_product` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_refund` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-monetization/commands/superboard-monetization.command.update_subscription` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.billing_ledger` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.entitlements` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.financial_customer_entitlements` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.migration_status` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.offerings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.packages` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.product_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.products` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.purchase` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.purchases` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.refunds` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.store_sync_runs` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-monetization/data-sources/superboard-monetization.data_source.subscriptions` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/customers/:customerId/entitlements` |
| `POST` | `/api/v1/billing/projects/:projectRef/ledger/migrate-products` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/migration/status` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/purchases` |
| `POST` | `/api/v1/billing/projects/:projectRef/ledger/purchases` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId` |
| `POST` | `/api/v1/billing/projects/:projectRef/ledger/purchases/:purchaseId/refunds` |
| `POST` | `/api/v1/billing/projects/:projectRef/ledger/reconcile` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/refunds` |
| `PUT` | `/api/v1/billing/projects/:projectRef/ledger/refunds/:refundId` |
| `GET` | `/api/v1/billing/projects/:projectRef/ledger/subscriptions` |
| `PUT` | `/api/v1/billing/projects/:projectRef/ledger/subscriptions/:id` |
| `GET` | `/api/v1/products/projects/:projectRef/catalog/products` |
| `POST` | `/api/v1/products/projects/:projectRef/catalog/products` |
| `DELETE` | `/api/v1/products/projects/:projectRef/catalog/products/:id` |
| `PUT` | `/api/v1/products/projects/:projectRef/catalog/products/:id` |
| `POST` | `/api/v1/products/projects/:projectRef/catalog/sync` |
| `GET` | `/api/v1/products/projects/:projectRef/catalog/syncs` |
| `GET` | `/api/v1/products/projects/:projectRef/entitlements` |
| `POST` | `/api/v1/products/projects/:projectRef/entitlements` |
| `DELETE` | `/api/v1/products/projects/:projectRef/entitlements/:id` |
| `PUT` | `/api/v1/products/projects/:projectRef/entitlements/:id` |
| `GET` | `/api/v1/products/projects/:projectRef/offerings` |
| `POST` | `/api/v1/products/projects/:projectRef/offerings` |
| `DELETE` | `/api/v1/products/projects/:projectRef/offerings/:id` |
| `PUT` | `/api/v1/products/projects/:projectRef/offerings/:id` |
| `GET` | `/api/v1/products/projects/:projectRef/packages` |
| `POST` | `/api/v1/products/projects/:projectRef/packages` |
| `DELETE` | `/api/v1/products/projects/:projectRef/packages/:id` |
| `PUT` | `/api/v1/products/projects/:projectRef/packages/:id` |
| `GET` | `/api/v1/products/projects/:projectRef/statistics` |

## Plugin — Communication

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_email_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_marketing_channel_connector` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_marketing_journey` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.create_notification` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.delete_marketing_channel_connector` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.delete_smtp_settings` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.discard_dead_letter` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.replay_dead_letter` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.retry_delivery_outbox` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.save_smtp_settings` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.schedule_email_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.send_transactional_email` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.test_smtp_settings` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.transition_email_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.transition_marketing_journey` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_email_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_marketing_channel_connector` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.update_marketing_journey` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-communication/commands/superboard-communication.command.verify_smtp_domain` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.dead_letters` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.delivery_outbox` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_campaigns` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_subscribers` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.email_templates` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.journey_enrollments` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.journey_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_channel_connectors` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_journeys` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.marketing_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.notifications` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.provider_events` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.provider_webhooks` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.smtp_settings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.subscriber_lists` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-communication/data-sources/superboard-communication.data_source.subscriber_segments` |
| `GET` | `/api/v1/email/projects/:projectRef/provider-events` |
| `GET` | `/api/v1/email/projects/:projectRef/settings/dead-letters` |
| `POST` | `/api/v1/email/projects/:projectRef/settings/dead-letters/:id/discard` |
| `POST` | `/api/v1/email/projects/:projectRef/settings/dead-letters/:id/replay` |
| `GET` | `/api/v1/email/projects/:projectRef/settings/delivery-outbox` |
| `POST` | `/api/v1/email/projects/:projectRef/settings/delivery-outbox/:id/retry` |
| `GET` | `/api/v1/email/projects/:projectRef/settings/provider-webhooks` |
| `GET` | `/api/v1/email/projects/:projectRef/settings/smtp` |
| `PUT` | `/api/v1/email/projects/:projectRef/settings/smtp` |
| `DELETE` | `/api/v1/email/projects/:projectRef/settings/smtp/:id` |
| `POST` | `/api/v1/email/projects/:projectRef/settings/smtp/:profileId/verify-domain` |
| `POST` | `/api/v1/email/projects/:projectRef/settings/smtp/test` |
| `POST` | `/api/v1/email/projects/:projectRef/transactional` |
| `GET` | `/api/v1/marketing/projects/:projectRef/campaigns` |
| `POST` | `/api/v1/marketing/projects/:projectRef/campaigns` |
| `PATCH` | `/api/v1/marketing/projects/:projectRef/campaigns/:id` |
| `POST` | `/api/v1/marketing/projects/:projectRef/campaigns/:id/:transition` |
| `POST` | `/api/v1/marketing/projects/:projectRef/campaigns/:id/schedule` |
| `GET` | `/api/v1/marketing/projects/:projectRef/channel-connectors` |
| `POST` | `/api/v1/marketing/projects/:projectRef/channel-connectors` |
| `DELETE` | `/api/v1/marketing/projects/:projectRef/channel-connectors/:id` |
| `PATCH` | `/api/v1/marketing/projects/:projectRef/channel-connectors/:id` |
| `GET` | `/api/v1/marketing/projects/:projectRef/email/subscribers` |
| `GET` | `/api/v1/marketing/projects/:projectRef/journeys` |
| `POST` | `/api/v1/marketing/projects/:projectRef/journeys` |
| `PATCH` | `/api/v1/marketing/projects/:projectRef/journeys/:id` |
| `POST` | `/api/v1/marketing/projects/:projectRef/journeys/:id/:transition` |
| `GET` | `/api/v1/marketing/projects/:projectRef/journeys/:id/enrollments` |
| `GET` | `/api/v1/marketing/projects/:projectRef/journeys/:id/statistics` |
| `GET` | `/api/v1/marketing/projects/:projectRef/lists` |
| `GET` | `/api/v1/marketing/projects/:projectRef/segments` |
| `GET` | `/api/v1/marketing/projects/:projectRef/statistics` |
| `GET` | `/api/v1/marketing/projects/:projectRef/templates` |
| `POST` | `/api/v1/projects/:projectRef/notifications` |
| `POST` | `/api/v1/projects/:projectRef/notifications/search` |

## Plugin — Acquisition

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.activate_version` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.archive_paywall` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.archive_paywall_experience` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_domain` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_environment` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_link` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_link_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_experience` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_targeting_rule` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_onboarding_version` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall_experience` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_paywall_version` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_redirect_rule` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.create_workflow` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_domain` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_link` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_link_campaign` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_onboarding` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.delete_redirect_rule` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_onboarding` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_paywall_version` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.publish_workflow` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.rotate_environment_key` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_localization` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_onboarding_placement` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_paywall_placement` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_social_preview` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.save_tracking` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.set_onboarding_experience_status` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_link` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_onboarding` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_paywall` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_paywall_experience` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_redirect_rule` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.update_workflow` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-acquisition/commands/superboard-acquisition.command.verify_domain` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.components` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.domains` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.environments` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_campaign_analytics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_campaigns` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.link_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.links` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.localization` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_experiences` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_placements` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_targeting_rules` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboarding_versions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.onboardings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.overview` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_experiences` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_placements` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_statistics` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywall_versions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.paywalls` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.redirect_rules` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.resolved_link` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.social_preview` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.tracking` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.user_details` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.users` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.workflow` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-acquisition/data-sources/superboard-acquisition.data_source.workflows` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/campaign-analytics` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/campaigns` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/campaigns` |
| `DELETE` | `/api/v1/dynamic-links/projects/:projectRef/campaigns/:id` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/domains` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/domains` |
| `DELETE` | `/api/v1/dynamic-links/projects/:projectRef/domains/:id` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/domains/:id/verify` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/links` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/links` |
| `DELETE` | `/api/v1/dynamic-links/projects/:projectRef/links/:id` |
| `PUT` | `/api/v1/dynamic-links/projects/:projectRef/links/:id` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/links/:slug/resolve` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/redirect-rules` |
| `POST` | `/api/v1/dynamic-links/projects/:projectRef/redirect-rules` |
| `DELETE` | `/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id` |
| `PUT` | `/api/v1/dynamic-links/projects/:projectRef/redirect-rules/:id` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/social-preview` |
| `PUT` | `/api/v1/dynamic-links/projects/:projectRef/social-preview` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/statistics` |
| `GET` | `/api/v1/dynamic-links/projects/:projectRef/tracking` |
| `PUT` | `/api/v1/dynamic-links/projects/:projectRef/tracking` |
| `GET` | `/api/v1/flows/projects/:projectRef/components` |
| `GET` | `/api/v1/flows/projects/:projectRef/environments` |
| `POST` | `/api/v1/flows/projects/:projectRef/environments` |
| `POST` | `/api/v1/flows/projects/:projectRef/environments/:environmentId/rotate-key` |
| `GET` | `/api/v1/flows/projects/:projectRef/localization` |
| `PUT` | `/api/v1/flows/projects/:projectRef/localization` |
| `GET` | `/api/v1/flows/projects/:projectRef/overview` |
| `GET` | `/api/v1/flows/projects/:projectRef/users` |
| `GET` | `/api/v1/flows/projects/:projectRef/users/:userHash` |
| `GET` | `/api/v1/flows/projects/:projectRef/workflows` |
| `POST` | `/api/v1/flows/projects/:projectRef/workflows` |
| `GET` | `/api/v1/flows/projects/:projectRef/workflows/:workflowId` |
| `PUT` | `/api/v1/flows/projects/:projectRef/workflows/:workflowId` |
| `POST` | `/api/v1/flows/projects/:projectRef/workflows/:workflowId/publish` |
| `POST` | `/api/v1/flows/projects/:projectRef/workflows/:workflowId/releases` |
| `GET` | `/api/v1/onboardings/projects/:projectRef` |
| `POST` | `/api/v1/onboardings/projects/:projectRef` |
| `DELETE` | `/api/v1/onboardings/projects/:projectRef/:onboardingId` |
| `PUT` | `/api/v1/onboardings/projects/:projectRef/:onboardingId` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/:onboardingId/publish` |
| `GET` | `/api/v1/onboardings/projects/:projectRef/:onboardingId/versions` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/:onboardingId/versions` |
| `GET` | `/api/v1/onboardings/projects/:projectRef/experiences` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/experiences` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/experiences/:experienceId/status` |
| `GET` | `/api/v1/onboardings/projects/:projectRef/placements` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/placements` |
| `PUT` | `/api/v1/onboardings/projects/:projectRef/placements/:placementId` |
| `GET` | `/api/v1/onboardings/projects/:projectRef/statistics` |
| `GET` | `/api/v1/onboardings/projects/:projectRef/targeting-rules` |
| `POST` | `/api/v1/onboardings/projects/:projectRef/targeting-rules` |
| `GET` | `/api/v1/paywalls/projects/:projectRef` |
| `POST` | `/api/v1/paywalls/projects/:projectRef` |
| `GET` | `/api/v1/paywalls/projects/:projectRef/experiences` |
| `POST` | `/api/v1/paywalls/projects/:projectRef/experiences` |
| `DELETE` | `/api/v1/paywalls/projects/:projectRef/experiences/:experienceId` |
| `PUT` | `/api/v1/paywalls/projects/:projectRef/experiences/:experienceId` |
| `DELETE` | `/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId` |
| `PUT` | `/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId` |
| `GET` | `/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions` |
| `POST` | `/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions` |
| `POST` | `/api/v1/paywalls/projects/:projectRef/paywalls/:paywallId/versions/:versionId/publish` |
| `GET` | `/api/v1/paywalls/projects/:projectRef/placements` |
| `POST` | `/api/v1/paywalls/projects/:projectRef/placements` |
| `PUT` | `/api/v1/paywalls/projects/:projectRef/placements/:id` |
| `GET` | `/api/v1/paywalls/projects/:projectRef/statistics` |

## Plugin — Support

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_configuration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_integration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_provider` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_configuration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_integration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_provider` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.publish_support_article` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.revoke_support_webhook_secret` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.rotate_support_webhook_secret` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.send_inbox_message` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_inbox_conversation` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_configuration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_integration` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_provider` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_settings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_conversations` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_messages` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_articles` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_assistant_tasks` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_categories` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_channels` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_folders` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_integrations` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_portals` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_providers` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_settings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.unified_inbox_items` |
| `GET` | `/api/v1/support/projects/:projectRef/captain/tasks` |
| `GET` | `/api/v1/support/projects/:projectRef/channels` |
| `GET` | `/api/v1/support/projects/:projectRef/conversations` |
| `PATCH` | `/api/v1/support/projects/:projectRef/conversations/:conversationId` |
| `GET` | `/api/v1/support/projects/:projectRef/conversations/:conversationId/messages` |
| `POST` | `/api/v1/support/projects/:projectRef/conversations/:conversationId/messages` |
| `GET` | `/api/v1/support/projects/:projectRef/help-center/articles` |
| `POST` | `/api/v1/support/projects/:projectRef/help-center/articles/:id/publish` |
| `GET` | `/api/v1/support/projects/:projectRef/help-center/categories` |
| `GET` | `/api/v1/support/projects/:projectRef/help-center/folders` |
| `GET` | `/api/v1/support/projects/:projectRef/help-center/portals` |
| `GET` | `/api/v1/support/projects/:projectRef/integrations` |
| `POST` | `/api/v1/support/projects/:projectRef/integrations` |
| `DELETE` | `/api/v1/support/projects/:projectRef/integrations/:id` |
| `PATCH` | `/api/v1/support/projects/:projectRef/integrations/:id` |
| `GET` | `/api/v1/support/projects/:projectRef/items` |
| `GET` | `/api/v1/support/projects/:projectRef/providers` |
| `POST` | `/api/v1/support/projects/:projectRef/providers` |
| `DELETE` | `/api/v1/support/projects/:projectRef/providers/:id` |
| `PATCH` | `/api/v1/support/projects/:projectRef/providers/:id` |
| `GET` | `/api/v1/support/projects/:projectRef/settings` |
| `PATCH` | `/api/v1/support/projects/:projectRef/settings` |
| `POST` | `/api/v1/support/projects/:projectRef/settings/entities` |
| `DELETE` | `/api/v1/support/projects/:projectRef/settings/entities/:entityId` |
| `PATCH` | `/api/v1/support/projects/:projectRef/settings/entities/:entityId` |
| `DELETE` | `/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret` |
| `PUT` | `/api/v1/support/projects/:projectRef/settings/entities/:entityId/secret` |

## Plugin — Analytics

Routes déclarées par le diagnostic local, y compris les adaptateurs et les commandes/sources de données EmDash.

| Méthode | Chemin |
| --- | --- |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_alert` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_cohort` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_dashboard` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_operation` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_report` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_dashboard` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_report` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.evaluate_analytics_cohort` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_dashboard` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_report` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_settings` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.upsert_analytics_remote_config` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_alerts` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_cohorts` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_crashes` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dashboards` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dimensions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_event_analysis` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_events` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_feedback` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_installations` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_overview` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_profiles` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_purchases` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_remote_config` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_reports` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_retention` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_sessions` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_settings` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_views` |
| `GET` | `/api/v1/analytics/projects/:projectRef/alerts` |
| `POST` | `/api/v1/analytics/projects/:projectRef/alerts` |
| `GET` | `/api/v1/analytics/projects/:projectRef/cohorts` |
| `POST` | `/api/v1/analytics/projects/:projectRef/cohorts` |
| `POST` | `/api/v1/analytics/projects/:projectRef/cohorts/:id/evaluate` |
| `GET` | `/api/v1/analytics/projects/:projectRef/crashes` |
| `GET` | `/api/v1/analytics/projects/:projectRef/dashboards` |
| `POST` | `/api/v1/analytics/projects/:projectRef/dashboards` |
| `DELETE` | `/api/v1/analytics/projects/:projectRef/dashboards/:id` |
| `PUT` | `/api/v1/analytics/projects/:projectRef/dashboards/:id` |
| `GET` | `/api/v1/analytics/projects/:projectRef/dimensions` |
| `GET` | `/api/v1/analytics/projects/:projectRef/events` |
| `GET` | `/api/v1/analytics/projects/:projectRef/events/analyze` |
| `GET` | `/api/v1/analytics/projects/:projectRef/feedback` |
| `GET` | `/api/v1/analytics/projects/:projectRef/installations` |
| `POST` | `/api/v1/analytics/projects/:projectRef/operations` |
| `GET` | `/api/v1/analytics/projects/:projectRef/overview` |
| `GET` | `/api/v1/analytics/projects/:projectRef/profiles` |
| `GET` | `/api/v1/analytics/projects/:projectRef/purchases` |
| `GET` | `/api/v1/analytics/projects/:projectRef/remote-config` |
| `PUT` | `/api/v1/analytics/projects/:projectRef/remote-config/:key` |
| `GET` | `/api/v1/analytics/projects/:projectRef/reports` |
| `POST` | `/api/v1/analytics/projects/:projectRef/reports` |
| `DELETE` | `/api/v1/analytics/projects/:projectRef/reports/:id` |
| `PUT` | `/api/v1/analytics/projects/:projectRef/reports/:id` |
| `GET` | `/api/v1/analytics/projects/:projectRef/retention` |
| `GET` | `/api/v1/analytics/projects/:projectRef/sessions` |
| `GET` | `/api/v1/analytics/projects/:projectRef/settings` |
| `PUT` | `/api/v1/analytics/projects/:projectRef/settings` |
| `GET` | `/api/v1/analytics/projects/:projectRef/views` |

## Façade API — registre complet extrait

Registre Hono du code courant, après composition des routeurs. Les middlewares généraux ont été exclus ; les délégations génériques restent indiquées par `ALL`.

| Méthode | Chemin |
| --- | --- |
| `GET` | `/` |
| `POST` | `/` |
| `GET` | `/*` |
| `GET` | `/.well-known/apple-app-site-association` |
| `GET` | `/.well-known/assetlinks.json` |
| `GET` | `/.well-known/jwks.json` |
| `GET` | `/.well-known/oauth-authorization-server` |
| `GET` | `/.well-known/oauth-protected-resource` |
| `GET` | `/.well-known/purchases-jwks.json` |
| `GET` | `/:code` |
| `POST` | `/api/v1/admin/billing/rewrap_credentials` |
| `POST` | `/api/v1/admin/flush_events` |
| `POST` | `/api/v1/admin/migrate_firebase_links` |
| `GET` | `/api/v1/admin/module-cutover/flows-routing/:projectRef` |
| `PUT` | `/api/v1/admin/module-cutover/flows-routing/:projectRef` |
| `GET` | `/api/v1/admin/module-cutover/maintenance/:projectRef` |
| `PUT` | `/api/v1/admin/module-cutover/maintenance/:projectRef` |
| `POST` | `/api/v1/admin/module-cutover/user-hashes/:projectRef` |
| `ALL` | `/api/v1/analytics` |
| `ALL` | `/api/v1/analytics/*` |
| `POST` | `/api/v1/analytics/events` |
| `POST` | `/api/v1/analytics/remote-config/resolve` |
| `ALL` | `/api/v1/app` |
| `ALL` | `/api/v1/app-files` |
| `ALL` | `/api/v1/app-files/*` |
| `ALL` | `/api/v1/app/*` |
| `POST` | `/api/v1/app/events` |
| `POST` | `/api/v1/app/runtime-policy` |
| `ALL` | `/api/v1/application-identity/:kind/:id` |
| `GET` | `/api/v1/application-users/projects/:projectRef/members` |
| `ALL` | `/api/v1/application-users/projects/:projectRef/profiles/:userId` |
| `POST` | `/api/v1/application-users/projects/:projectRef/profiles/:userId/resume` |
| `GET` | `/api/v1/application-users/projects/:projectRef/profiles/:userId/security` |
| `POST` | `/api/v1/application-users/projects/:projectRef/profiles/:userId/sessions/:sessionId/revoke` |
| `POST` | `/api/v1/application-users/projects/:projectRef/profiles/:userId/suspend` |
| `GET` | `/api/v1/application-users/projects/:projectRef/users` |
| `GET` | `/api/v1/application-users/projects/:projectRef/users/:userId` |
| `GET` | `/api/v1/auth/me` |
| `POST` | `/api/v1/auth/sign_in` |
| `POST` | `/api/v1/auth/sign_up` |
| `POST` | `/api/v1/automation/details_for_link` |
| `POST` | `/api/v1/automation/metrics_for_user` |
| `POST` | `/api/v1/automation/run_maintenance` |
| `GET` | `/api/v1/billing/:projectId` |
| `POST` | `/api/v1/billing/:projectId/credentials/test` |
| `GET` | `/api/v1/billing/:projectId/customers` |
| `GET` | `/api/v1/billing/:projectId/customers/:customerId` |
| `POST` | `/api/v1/billing/:projectId/customers/:customerId/block` |
| `DELETE` | `/api/v1/billing/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `/api/v1/billing/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `/api/v1/billing/:projectId/customers/:customerId/merge` |
| `GET` | `/api/v1/billing/:projectId/entitlements` |
| `POST` | `/api/v1/billing/:projectId/entitlements` |
| `POST` | `/api/v1/billing/:projectId/entitlements/:entitlementId/products` |
| `DELETE` | `/api/v1/billing/:projectId/entitlements/:id` |
| `PATCH` | `/api/v1/billing/:projectId/entitlements/:id` |
| `GET` | `/api/v1/billing/:projectId/mirror` |
| `POST` | `/api/v1/billing/:projectId/mirror/compare` |
| `POST` | `/api/v1/billing/:projectId/offerings` |
| `DELETE` | `/api/v1/billing/:projectId/offerings/:id` |
| `PATCH` | `/api/v1/billing/:projectId/offerings/:id` |
| `POST` | `/api/v1/billing/:projectId/offerings/:offeringId/packages` |
| `DELETE` | `/api/v1/billing/:projectId/offerings/:offeringId/packages/:id` |
| `PATCH` | `/api/v1/billing/:projectId/offerings/:offeringId/packages/:id` |
| `GET` | `/api/v1/billing/:projectId/oidc` |
| `POST` | `/api/v1/billing/:projectId/oidc` |
| `GET` | `/api/v1/billing/:projectId/products` |
| `POST` | `/api/v1/billing/:projectId/products` |
| `DELETE` | `/api/v1/billing/:projectId/products/:id` |
| `PATCH` | `/api/v1/billing/:projectId/products/:id` |
| `POST` | `/api/v1/billing/:projectId/products/:productId/entitlements/:entitlementId` |
| `POST` | `/api/v1/billing/:projectId/products/sync` |
| `PUT` | `/api/v1/billing/:projectId/settings` |
| `GET` | `/api/v1/billing/:projectId/stripe` |
| `POST` | `/api/v1/billing/:projectId/stripe` |
| `POST` | `/api/v1/billing/:projectId/stripe/sync` |
| `POST` | `/api/v1/billing/:projectId/stripe/test` |
| `GET` | `/api/v1/billing/:projectId/webhooks` |
| `POST` | `/api/v1/billing/:projectId/webhooks` |
| `DELETE` | `/api/v1/billing/:projectId/webhooks/:id` |
| `ALL` | `/api/v1/billing/projects/:projectRef/ledger` |
| `ALL` | `/api/v1/billing/projects/:projectRef/ledger/:rest{.+}` |
| `POST` | `/api/v1/billing/projects/:projectRef/ledger/migrate-products` |
| `POST` | `/api/v1/collection/events` |
| `GET` | `/api/v1/diagnostics/test_diagnostics` |
| `POST` | `/api/v1/diagnostics/test_diagnostics` |
| `GET` | `/api/v1/diagnostics/test_exception` |
| `POST` | `/api/v1/diagnostics/test_exception` |
| `GET` | `/api/v1/diagnostics/test_logs` |
| `POST` | `/api/v1/diagnostics/test_logs` |
| `ALL` | `/api/v1/dynamic-links` |
| `ALL` | `/api/v1/dynamic-links/*` |
| `ALL` | `/api/v1/email` |
| `ALL` | `/api/v1/email/*` |
| `POST` | `/api/v1/email/aws-ses/events` |
| `POST` | `/api/v1/email/provider-webhooks/:endpointId` |
| `ALL` | `/api/v1/files/projects/:projectRef/:rest{.+}` |
| `ALL` | `/api/v1/flows` |
| `ALL` | `/api/v1/flows/*` |
| `POST` | `/api/v1/flows/v2/sdk/blocks` |
| `POST` | `/api/v1/flows/v2/sdk/events` |
| `POST` | `/api/v1/flows/v2/sdk/survey` |
| `POST` | `/api/v1/flows/v2/sdk/workflows` |
| `GET` | `/api/v1/flows/ws/sdk/block-updates` |
| `ALL` | `/api/v1/gateway/:rest{.+}` |
| `POST` | `/api/v1/iap/apple/production/:path` |
| `POST` | `/api/v1/iap/apple/test/:path` |
| `POST` | `/api/v1/iap/google/:path` |
| `POST` | `/api/v1/iap/reconcile_subscriptions` |
| `ALL` | `/api/v1/identity-admin/projects/:projectRef` |
| `ALL` | `/api/v1/identity-admin/projects/:projectRef/:rest{.+}` |
| `POST` | `/api/v1/identity/sso/auth/:provider` |
| `GET` | `/api/v1/identity/sso/auth/:provider/callback` |
| `POST` | `/api/v1/identity/sso/auth/:provider/callback` |
| `GET` | `/api/v1/identity/sso/auth/failure` |
| `POST` | `/api/v1/identity/sso/tokens/refresh` |
| `GET` | `/api/v1/instances` |
| `POST` | `/api/v1/instances` |
| `DELETE` | `/api/v1/instances/:id` |
| `GET` | `/api/v1/instances/:id` |
| `PUT` | `/api/v1/instances/:id` |
| `GET` | `/api/v1/instances/:id/configurations` |
| `DELETE` | `/api/v1/instances/:id/configurations/android` |
| `GET` | `/api/v1/instances/:id/configurations/android` |
| `PUT` | `/api/v1/instances/:id/configurations/android` |
| `PUT` | `/api/v1/instances/:id/configurations/android/api_access_key` |
| `GET` | `/api/v1/instances/:id/configurations/android/google_configuration_script` |
| `GET` | `/api/v1/instances/:id/configurations/android/push` |
| `PUT` | `/api/v1/instances/:id/configurations/android/push` |
| `DELETE` | `/api/v1/instances/:id/configurations/desktop` |
| `GET` | `/api/v1/instances/:id/configurations/desktop` |
| `PUT` | `/api/v1/instances/:id/configurations/desktop` |
| `DELETE` | `/api/v1/instances/:id/configurations/ios` |
| `GET` | `/api/v1/instances/:id/configurations/ios` |
| `PUT` | `/api/v1/instances/:id/configurations/ios` |
| `PUT` | `/api/v1/instances/:id/configurations/ios/api_access_key` |
| `GET` | `/api/v1/instances/:id/configurations/ios/push` |
| `PUT` | `/api/v1/instances/:id/configurations/ios/push` |
| `DELETE` | `/api/v1/instances/:id/configurations/web` |
| `GET` | `/api/v1/instances/:id/configurations/web` |
| `PUT` | `/api/v1/instances/:id/configurations/web` |
| `POST` | `/api/v1/instances/:id/dismiss_get_started` |
| `POST` | `/api/v1/instances/:id/events/billing` |
| `POST` | `/api/v1/instances/:id/exports/usage` |
| `DELETE` | `/api/v1/instances/:id/members` |
| `GET` | `/api/v1/instances/:id/members` |
| `POST` | `/api/v1/instances/:id/members` |
| `PUT` | `/api/v1/instances/:id/revenue_collection` |
| `GET` | `/api/v1/instances/:id/role` |
| `GET` | `/api/v1/instances/:id/setup_progress` |
| `POST` | `/api/v1/instances/:id/setup_progress/complete` |
| `GET` | `/api/v1/links` |
| `POST` | `/api/v1/links` |
| `DELETE` | `/api/v1/links/:id` |
| `GET` | `/api/v1/links/:id` |
| `PATCH` | `/api/v1/links/:id` |
| `ALL` | `/api/v1/marketing` |
| `ALL` | `/api/v1/marketing/*` |
| `ALL` | `/api/v1/marketing/opt-in/:token` |
| `POST` | `/api/v1/marketing/provider-webhooks/:endpointId` |
| `ALL` | `/api/v1/marketing/tracking/:action/:token` |
| `POST` | `/api/v1/mcp/analytics/link` |
| `POST` | `/api/v1/mcp/analytics/overview` |
| `POST` | `/api/v1/mcp/analytics/top_links` |
| `POST` | `/api/v1/mcp/approve_consent` |
| `POST` | `/api/v1/mcp/campaigns` |
| `DELETE` | `/api/v1/mcp/campaigns/:campaignId` |
| `POST` | `/api/v1/mcp/campaigns/search` |
| `GET` | `/api/v1/mcp/consent-request` |
| `POST` | `/api/v1/mcp/links` |
| `DELETE` | `/api/v1/mcp/links/:id` |
| `PATCH` | `/api/v1/mcp/links/:id` |
| `GET` | `/api/v1/mcp/links/by-path/:path` |
| `POST` | `/api/v1/mcp/links/search` |
| `ALL` | `/api/v1/mcp/operator/*` |
| `GET` | `/api/v1/mcp/platform-status` |
| `POST` | `/api/v1/mcp/projects` |
| `PUT` | `/api/v1/mcp/redirects` |
| `PUT` | `/api/v1/mcp/sdk` |
| `GET` | `/api/v1/mcp/status` |
| `DELETE` | `/api/v1/mcp/token` |
| `GET` | `/api/v1/mcp/tokens` |
| `DELETE` | `/api/v1/mcp/tokens/:tokenId` |
| `GET` | `/api/v1/mcp/usage` |
| `GET` | `/api/v1/mcp/validate` |
| `ALL` | `/api/v1/observability/*` |
| `ALL` | `/api/v1/onboardings` |
| `ALL` | `/api/v1/onboardings/*` |
| `POST` | `/api/v1/onboardings/events` |
| `POST` | `/api/v1/onboardings/resolve` |
| `ALL` | `/api/v1/paywalls` |
| `ALL` | `/api/v1/paywalls/*` |
| `POST` | `/api/v1/paywalls/events` |
| `POST` | `/api/v1/paywalls/resolve` |
| `GET` | `/api/v1/platform/account-erasures` |
| `GET` | `/api/v1/platform/custom/jobs` |
| `GET` | `/api/v1/platform/custom/jobs/:jobId` |
| `POST` | `/api/v1/platform/custom/jobs/:jobId/retry` |
| `GET` | `/api/v1/platform/custom/stats` |
| `POST` | `/api/v1/platform/email/dead-letters/:deadLetterId/discard` |
| `POST` | `/api/v1/platform/email/dead-letters/:deadLetterId/replay` |
| `GET` | `/api/v1/platform/email/operations` |
| `GET` | `/api/v1/platform/libraries` |
| `GET` | `/api/v1/platform/status` |
| `ALL` | `/api/v1/plugins/:plugin/projects/:projectRef/*` |
| `ALL` | `/api/v1/products` |
| `ALL` | `/api/v1/products/*` |
| `POST` | `/api/v1/products/offerings/resolve` |
| `POST` | `/api/v1/projects/:id/campaigns` |
| `DELETE` | `/api/v1/projects/:id/campaigns/:campaignId` |
| `GET` | `/api/v1/projects/:id/campaigns/:campaignId` |
| `PATCH` | `/api/v1/projects/:id/campaigns/:campaignId` |
| `POST` | `/api/v1/projects/:id/campaigns/metrics_overview` |
| `POST` | `/api/v1/projects/:id/campaigns/search` |
| `POST` | `/api/v1/projects/:id/campaigns/search_v2` |
| `POST` | `/api/v1/projects/:id/dashboard/links_views` |
| `POST` | `/api/v1/projects/:id/dashboard/metrics_overview` |
| `POST` | `/api/v1/projects/:id/dashboard/top_links` |
| `GET` | `/api/v1/projects/:id/domain` |
| `PUT` | `/api/v1/projects/:id/domain` |
| `POST` | `/api/v1/projects/:id/domain/check_availability` |
| `GET` | `/api/v1/projects/:id/domain/defaults` |
| `PUT` | `/api/v1/projects/:id/domain/google_tracking_id` |
| `GET` | `/api/v1/projects/:id/events/metric_values` |
| `POST` | `/api/v1/projects/:id/events/overview` |
| `POST` | `/api/v1/projects/:id/events/search` |
| `POST` | `/api/v1/projects/:id/events/sorted` |
| `POST` | `/api/v1/projects/:id/exports/links` |
| `POST` | `/api/v1/projects/:id/links` |
| `DELETE` | `/api/v1/projects/:id/links/:linkId` |
| `PATCH` | `/api/v1/projects/:id/links/:linkId` |
| `POST` | `/api/v1/projects/:id/links/by_ids` |
| `POST` | `/api/v1/projects/:id/links/check_path` |
| `GET` | `/api/v1/projects/:id/links/random_path` |
| `POST` | `/api/v1/projects/:id/links/search` |
| `POST` | `/api/v1/projects/:id/links/search_v2` |
| `POST` | `/api/v1/projects/:id/notifications` |
| `DELETE` | `/api/v1/projects/:id/notifications/:notifId` |
| `GET` | `/api/v1/projects/:id/notifications/:notifId` |
| `PATCH` | `/api/v1/projects/:id/notifications/:notifId` |
| `POST` | `/api/v1/projects/:id/notifications/:notifId/publish` |
| `POST` | `/api/v1/projects/:id/notifications/search` |
| `POST` | `/api/v1/projects/:id/purchases/revenue` |
| `POST` | `/api/v1/projects/:id/purchases/search` |
| `GET` | `/api/v1/projects/:id/redirect_config` |
| `PUT` | `/api/v1/projects/:id/redirect_config` |
| `PUT` | `/api/v1/projects/:id/redirect_config/redirect` |
| `GET` | `/api/v1/projects/:id/visitors/:visitorId` |
| `POST` | `/api/v1/projects/:id/visitors/aggregated` |
| `POST` | `/api/v1/projects/:id/visitors/aggregated_metrics` |
| `POST` | `/api/v1/projects/:id/visitors/metrics` |
| `POST` | `/api/v1/projects/:id/visitors/search` |
| `POST` | `/api/v1/projects/add_event` |
| `GET` | `/api/v1/projects/exports/:fileKey` |
| `POST` | `/api/v1/push/process` |
| `GET` | `/api/v1/sdk/.well-known/purchases-jwks.json` |
| `DELETE` | `/api/v1/sdk/account/v1` |
| `POST` | `/api/v1/sdk/add_payment_event` |
| `POST` | `/api/v1/sdk/attribution` |
| `POST` | `/api/v1/sdk/authenticate` |
| `POST` | `/api/v1/sdk/create_link` |
| `GET` | `/api/v1/sdk/custom/v1/jobs` |
| `POST` | `/api/v1/sdk/custom/v1/jobs` |
| `GET` | `/api/v1/sdk/custom/v1/jobs/:jobId` |
| `POST` | `/api/v1/sdk/custom/v1/jobs/:jobId/cancel` |
| `POST` | `/api/v1/sdk/data_for_device` |
| `POST` | `/api/v1/sdk/data_for_device_and_path` |
| `POST` | `/api/v1/sdk/data_for_device_and_url` |
| `GET` | `/api/v1/sdk/device_for_vendor_id` |
| `POST` | `/api/v1/sdk/event` |
| `POST` | `/api/v1/sdk/events` |
| `POST` | `/api/v1/sdk/generate_link` |
| `GET` | `/api/v1/sdk/link/:path` |
| `POST` | `/api/v1/sdk/link_details` |
| `POST` | `/api/v1/sdk/mark_notification_as_read` |
| `GET` | `/api/v1/sdk/metrics_for_link/:path` |
| `GET` | `/api/v1/sdk/metrics_for_project` |
| `GET` | `/api/v1/sdk/notifications` |
| `POST` | `/api/v1/sdk/notifications_for_device` |
| `GET` | `/api/v1/sdk/notifications_to_display_automatically` |
| `GET` | `/api/v1/sdk/number_of_unread_notifications` |
| `POST` | `/api/v1/sdk/purchases/v1/apple/transactions` |
| `GET` | `/api/v1/sdk/purchases/v1/customer-info` |
| `POST` | `/api/v1/sdk/purchases/v1/google/purchases` |
| `POST` | `/api/v1/sdk/purchases/v1/identify` |
| `GET` | `/api/v1/sdk/purchases/v1/offerings` |
| `POST` | `/api/v1/sdk/purchases/v1/restore` |
| `POST` | `/api/v1/sdk/purchases/v1/sync` |
| `POST` | `/api/v1/sdk/purchases/v2/apple/transactions` |
| `POST` | `/api/v1/sdk/purchases/v2/certification/device-results` |
| `GET` | `/api/v1/sdk/purchases/v2/configuration` |
| `GET` | `/api/v1/sdk/purchases/v2/customer-center` |
| `GET` | `/api/v1/sdk/purchases/v2/customer-info` |
| `POST` | `/api/v1/sdk/purchases/v2/events` |
| `POST` | `/api/v1/sdk/purchases/v2/google/purchases` |
| `POST` | `/api/v1/sdk/purchases/v2/identify` |
| `GET` | `/api/v1/sdk/purchases/v2/offerings` |
| `POST` | `/api/v1/sdk/purchases/v2/receipts` |
| `POST` | `/api/v1/sdk/purchases/v2/restore` |
| `POST` | `/api/v1/sdk/purchases/v2/stripe/checkout` |
| `POST` | `/api/v1/sdk/purchases/v2/stripe/portal` |
| `POST` | `/api/v1/sdk/purchases/v2/sync` |
| `GET` | `/api/v1/sdk/purchases/v2/virtual-currencies` |
| `POST` | `/api/v1/sdk/register` |
| `GET` | `/api/v1/sdk/visitor_attributes` |
| `POST` | `/api/v1/sdk/visitor_attributes` |
| `ALL` | `/api/v1/support` |
| `ALL` | `/api/v1/support-client` |
| `ALL` | `/api/v1/support-client/*` |
| `ALL` | `/api/v1/support-widget` |
| `ALL` | `/api/v1/support-widget/*` |
| `ALL` | `/api/v1/support/*` |
| `ALL` | `/api/v1/support/help-center` |
| `ALL` | `/api/v1/support/help-center/*` |
| `GET` | `/api/v1/support/providers/:provider/:endpointId/events` |
| `POST` | `/api/v1/support/providers/:provider/:endpointId/events` |
| `GET` | `/api/v1/support/providers/:provider/oauth/callback` |
| `GET` | `/api/v1/support/realtime/:ticket` |
| `POST` | `/api/v1/users` |
| `POST` | `/api/v1/users/accept_invite` |
| `POST` | `/api/v1/users/change_password` |
| `DELETE` | `/api/v1/users/me` |
| `GET` | `/api/v1/users/me` |
| `PATCH` | `/api/v1/users/me` |
| `GET` | `/api/v1/users/me/otp_qr` |
| `PUT` | `/api/v1/users/me/two_factor` |
| `POST` | `/api/v1/users/otp_status` |
| `POST` | `/api/v1/users/reset_password` |
| `GET` | `/api/v2/inbox/projects/:projectId/items` |
| `ALL` | `/api/v2/messaging/projects/:projectId/*` |
| `POST` | `/api/v2/messaging/projects/:projectId/conversations/:conversationId/realtime-ticket` |
| `GET` | `/api/v2/messaging/projects/:projectId/conversations/:conversationId/ws` |
| `GET` | `/api/v2/purchases/projects/:projectId` |
| `GET` | `/api/v2/purchases/projects/:projectId/analytics` |
| `GET` | `/api/v2/purchases/projects/:projectId/apple-server-notifications` |
| `POST` | `/api/v2/purchases/projects/:projectId/apple-server-notifications/configure` |
| `GET` | `/api/v2/purchases/projects/:projectId/audiences` |
| `POST` | `/api/v2/purchases/projects/:projectId/audiences` |
| `GET` | `/api/v2/purchases/projects/:projectId/certification-runs` |
| `POST` | `/api/v2/purchases/projects/:projectId/certification-runs` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/certification-runs/:runId` |
| `POST` | `/api/v2/purchases/projects/:projectId/certification-runs/:runId/device-challenge` |
| `POST` | `/api/v2/purchases/projects/:projectId/certification-runs/:runId/observations` |
| `GET` | `/api/v2/purchases/projects/:projectId/connections` |
| `POST` | `/api/v2/purchases/projects/:projectId/connections` |
| `POST` | `/api/v2/purchases/projects/:projectId/connections/:provider/test` |
| `POST` | `/api/v2/purchases/projects/:projectId/credentials/test` |
| `GET` | `/api/v2/purchases/projects/:projectId/customers` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/customers/:customerId` |
| `GET` | `/api/v2/purchases/projects/:projectId/customers/:customerId` |
| `POST` | `/api/v2/purchases/projects/:projectId/customers/:customerId/block` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `/api/v2/purchases/projects/:projectId/customers/:customerId/entitlements/:entitlementId` |
| `POST` | `/api/v2/purchases/projects/:projectId/customers/:customerId/merge` |
| `POST` | `/api/v2/purchases/projects/:projectId/customers/:customerId/virtual-currencies/adjust` |
| `GET` | `/api/v2/purchases/projects/:projectId/dead-letters` |
| `POST` | `/api/v2/purchases/projects/:projectId/dead-letters/:deadLetterId/discard` |
| `POST` | `/api/v2/purchases/projects/:projectId/dead-letters/:deadLetterId/replay` |
| `GET` | `/api/v2/purchases/projects/:projectId/entitlements` |
| `POST` | `/api/v2/purchases/projects/:projectId/entitlements` |
| `POST` | `/api/v2/purchases/projects/:projectId/entitlements/:entitlementId/products` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/entitlements/:id` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/entitlements/:id` |
| `GET` | `/api/v2/purchases/projects/:projectId/events` |
| `GET` | `/api/v2/purchases/projects/:projectId/experiments` |
| `POST` | `/api/v2/purchases/projects/:projectId/experiments` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/experiments/:id` |
| `GET` | `/api/v2/purchases/projects/:projectId/exports` |
| `POST` | `/api/v2/purchases/projects/:projectId/exports` |
| `GET` | `/api/v2/purchases/projects/:projectId/exports/:id/download` |
| `GET` | `/api/v2/purchases/projects/:projectId/features` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/features` |
| `GET` | `/api/v2/purchases/projects/:projectId/health` |
| `GET` | `/api/v2/purchases/projects/:projectId/integrations/deliveries` |
| `POST` | `/api/v2/purchases/projects/:projectId/integrations/deliveries/:id/replay` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/connection` |
| `POST` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/connection-test` |
| `POST` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/connections` |
| `GET` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory` |
| `POST` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory-runs` |
| `POST` | `/api/v2/purchases/projects/:projectId/legacy/revenuecat/inventory-runs/:runId/cancel` |
| `GET` | `/api/v2/purchases/projects/:projectId/mirror` |
| `POST` | `/api/v2/purchases/projects/:projectId/mirror/compare` |
| `POST` | `/api/v2/purchases/projects/:projectId/offerings` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/offerings/:id` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/offerings/:id` |
| `POST` | `/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages/:id` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/offerings/:offeringId/packages/:id` |
| `GET` | `/api/v2/purchases/projects/:projectId/oidc` |
| `POST` | `/api/v2/purchases/projects/:projectId/oidc` |
| `GET` | `/api/v2/purchases/projects/:projectId/paywall-event-types` |
| `GET` | `/api/v2/purchases/projects/:projectId/paywalls` |
| `POST` | `/api/v2/purchases/projects/:projectId/paywalls` |
| `POST` | `/api/v2/purchases/projects/:projectId/paywalls/:id/publish` |
| `GET` | `/api/v2/purchases/projects/:projectId/paywalls/:id/versions` |
| `POST` | `/api/v2/purchases/projects/:projectId/paywalls/:id/versions` |
| `GET` | `/api/v2/purchases/projects/:projectId/placements` |
| `POST` | `/api/v2/purchases/projects/:projectId/placements` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/placements/:id` |
| `GET` | `/api/v2/purchases/projects/:projectId/products` |
| `POST` | `/api/v2/purchases/projects/:projectId/products` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/products/:id` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/products/:id` |
| `POST` | `/api/v2/purchases/projects/:projectId/products/:productId/entitlements/:entitlementId` |
| `POST` | `/api/v2/purchases/projects/:projectId/products/sync` |
| `GET` | `/api/v2/purchases/projects/:projectId/provider-events` |
| `POST` | `/api/v2/purchases/projects/:projectId/provider-events/:eventId/replay` |
| `GET` | `/api/v2/purchases/projects/:projectId/refunds` |
| `GET` | `/api/v2/purchases/projects/:projectId/refunds/:caseId` |
| `POST` | `/api/v2/purchases/projects/:projectId/refunds/:caseId/actions` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/refunds/:caseId/actions/:actionId` |
| `POST` | `/api/v2/purchases/projects/:projectId/refunds/:caseId/actions/:actionId/approve` |
| `POST` | `/api/v2/purchases/projects/:projectId/refunds/:caseId/evidence` |
| `POST` | `/api/v2/purchases/projects/:projectId/refunds/:caseId/evidence/:evidenceId/review` |
| `GET` | `/api/v2/purchases/projects/:projectId/release-gate` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/release-gate/checks/:checkKey` |
| `PUT` | `/api/v2/purchases/projects/:projectId/settings` |
| `GET` | `/api/v2/purchases/projects/:projectId/stripe` |
| `POST` | `/api/v2/purchases/projects/:projectId/stripe` |
| `POST` | `/api/v2/purchases/projects/:projectId/stripe/sync` |
| `POST` | `/api/v2/purchases/projects/:projectId/stripe/test` |
| `GET` | `/api/v2/purchases/projects/:projectId/subscriptions` |
| `GET` | `/api/v2/purchases/projects/:projectId/targeting` |
| `POST` | `/api/v2/purchases/projects/:projectId/targeting` |
| `PATCH` | `/api/v2/purchases/projects/:projectId/targeting/:id` |
| `GET` | `/api/v2/purchases/projects/:projectId/transactions` |
| `GET` | `/api/v2/purchases/projects/:projectId/virtual-currencies` |
| `POST` | `/api/v2/purchases/projects/:projectId/virtual-currencies` |
| `POST` | `/api/v2/purchases/projects/:projectId/virtual-currencies/:currencyId/products/:productId` |
| `GET` | `/api/v2/purchases/projects/:projectId/webhooks` |
| `POST` | `/api/v2/purchases/projects/:projectId/webhooks` |
| `DELETE` | `/api/v2/purchases/projects/:projectId/webhooks/:id` |
| `POST` | `/api/v2/purchases/providers/webhooks/apple/:environment/:projectId` |
| `POST` | `/api/v2/purchases/providers/webhooks/stripe/:environment/:projectId` |
| `ALL` | `/auth` |
| `ALL` | `/auth/*` |
| `GET` | `/authorize` |
| `POST` | `/create` |
| `GET` | `/favicon.ico` |
| `GET` | `/health` |
| `GET` | `/health/billing` |
| `ALL` | `/internal/billing/catalog-ledger` |
| `ALL` | `/internal/billing/catalog-ledger/:rest{.+}` |
| `GET` | `/internal/collection/v1/:plugin/events` |
| `GET` | `/internal/collection/v1/:plugin/projects` |
| `POST` | `/internal/observability/observations` |
| `POST` | `/internal/plugin-tasks` |
| `POST` | `/internal/plugin-tasks/wake` |
| `ALL` | `/internal/site-operator/project-scope` |
| `GET` | `/internal/site/deployment-configuration` |
| `GET` | `/internal/site/plugin-health/:pluginId` |
| `POST` | `/internal/v1/push/support-notifications` |
| `GET` | `/mm/*` |
| `GET` | `/mm/:id` |
| `GET` | `/oauth/api/v1/me` |
| `POST` | `/oauth/revoke` |
| `POST` | `/oauth/token` |
| `GET` | `/oauth/token/info` |
| `GET` | `/public` |
| `GET` | `/quick-link-assets/*` |
| `POST` | `/register` |
| `POST` | `/token` |
| `GET` | `/up` |

## Manifest Gateway généré

| Méthode | Chemin | Destination | Authentification |
| --- | --- | --- | --- |
| `GET` | `/_emdash/api/plugins/superboard-audit/health` | `superboard-audit` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-audit/commands/superboard-audit.command.archive_ledger` | `superboard-audit` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-audit/commands/superboard-audit.command.verify_ledger` | `superboard-audit` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.archives` | `superboard-audit` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.ledger` | `superboard-audit` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-audit/data-sources/superboard-audit.data_source.ledger_search` | `superboard-audit` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-content/health` | `superboard-content` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.create_document` | `superboard-content` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.publish_document` | `superboard-content` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-content/commands/superboard-content.command.update_document` | `superboard-content` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.documents` | `superboard-content` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.revisions` | `superboard-content` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-content/data-sources/superboard-content.data_source.taxonomies` | `superboard-content` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-products/health` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_offering` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_package` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.archive_product` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_offering` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_package` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.create_product` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.sync_store_catalog` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_entitlement` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_offering` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_package` | `superboard-products` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-products/commands/superboard-products.command.update_product` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.entitlements` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.offerings` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.packages` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.product_statistics` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.products` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-products/data-sources/superboard-products.data_source.store_sync_runs` | `superboard-products` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-settings/health` | `superboard-settings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.save_sdk_configuration` | `superboard-settings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.test_sdk_configuration` | `superboard-settings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-settings/commands/superboard-settings.command.update_effective_settings` | `superboard-settings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.effective_settings` | `superboard-settings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.sdk_configurations` | `superboard-settings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-settings/data-sources/superboard-settings.data_source.settings_versions` | `superboard-settings` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-user/health` | `superboard-user` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.application_sign_in` | `superboard-user` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.link_provider` | `superboard-user` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.revoke_application_session` | `superboard-user` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.suspend_member` | `superboard-user` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-user/commands/superboard-user.command.update_profile` | `superboard-user` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.active_sessions` | `superboard-user` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.current_profile` | `superboard-user` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.linked_providers` | `superboard-user` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-user/data-sources/superboard-user.data_source.members` | `superboard-user` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-analytics/health` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_alert` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_cohort` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_operation` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.create_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.delete_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.evaluate_analytics_cohort` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_dashboard` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_report` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.update_analytics_settings` | `superboard-analytics` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-analytics/commands/superboard-analytics.command.upsert_analytics_remote_config` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_alerts` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_cohorts` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_crashes` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dashboards` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_dimensions` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_event_analysis` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_events` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_feedback` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_installations` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_overview` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_profiles` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_purchases` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_remote_config` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_reports` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_retention` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_sessions` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_settings` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-analytics/data-sources/superboard-analytics.data_source.analytics_views` | `superboard-analytics` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-billing/health` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.create_purchase` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.create_refund` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.migrate_products` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.reconcile_store` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.update_refund` | `superboard-billing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-billing/commands/superboard-billing.command.update_subscription` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.billing_ledger` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.financial_customer_entitlements` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.migration_status` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.purchase` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.purchases` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.refunds` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-billing/data-sources/superboard-billing.data_source.subscriptions` | `superboard-billing` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-dynamic-links/health` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_domain` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_link_campaign` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.create_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_domain` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_link_campaign` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.delete_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.save_social_preview` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.save_tracking` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.update_link` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.update_redirect_rule` | `superboard-dynamic-links` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/commands/superboard-dynamic-links.command.verify_domain` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.domains` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_campaign_analytics` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_campaigns` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.link_statistics` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.links` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.redirect_rules` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.resolved_link` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.social_preview` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-dynamic-links/data-sources/superboard-dynamic-links.data_source.tracking` | `superboard-dynamic-links` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-email/health` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.delete_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.discard_dead_letter` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.replay_dead_letter` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.retry_delivery_outbox` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.save_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.send_transactional_email` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.test_smtp_settings` | `superboard-email` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-email/commands/superboard-email.command.verify_smtp_domain` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.dead_letters` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.delivery_outbox` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.provider_events` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.provider_webhooks` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-email/data-sources/superboard-email.data_source.smtp_settings` | `superboard-email` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-files/health` | `superboard-files` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.collect_garbage` | `superboard-files` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.complete_upload` | `superboard-files` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.create_upload_ticket` | `superboard-files` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-files/commands/superboard-files.command.delete_object` | `superboard-files` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.download_ticket` | `superboard-files` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.object_metadata` | `superboard-files` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.objects` | `superboard-files` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-files/data-sources/superboard-files.data_source.storage_usage` | `superboard-files` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-flows/health` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.activate_version` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.create_environment` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.create_workflow` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.publish_workflow` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.rotate_environment_key` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.save_localization` | `superboard-flows` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-flows/commands/superboard-flows.command.update_workflow` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.components` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.environments` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.localization` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.overview` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.user_details` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.users` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.workflow` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-flows/data-sources/superboard-flows.data_source.workflows` | `superboard-flows` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-gateway/health` | `superboard-gateway` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.publish_gateway_manifest` | `superboard-gateway` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.rotate_access_policy` | `superboard-gateway` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-gateway/commands/superboard-gateway.command.update_gateway_route` | `superboard-gateway` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.active_gateway_manifest` | `superboard-gateway` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.gateway_routes` | `superboard-gateway` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-gateway/data-sources/superboard-gateway.data_source.rate_limits` | `superboard-gateway` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-marketing/health` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_marketing_journey` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.create_notification` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.delete_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.schedule_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.transition_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.transition_marketing_journey` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_email_campaign` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_marketing_channel_connector` | `superboard-marketing` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-marketing/commands/superboard-marketing.command.update_marketing_journey` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_campaigns` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_subscribers` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.email_templates` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.journey_enrollments` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.journey_statistics` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_channel_connectors` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_journeys` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.marketing_statistics` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.notifications` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.subscriber_lists` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-marketing/data-sources/superboard-marketing.data_source.subscriber_segments` | `superboard-marketing` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-mcp/health` | `superboard-mcp` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.approve_consent` | `superboard-mcp` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.invoke_tool` | `superboard-mcp` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-mcp/commands/superboard-mcp.command.revoke_token` | `superboard-mcp` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.sessions` | `superboard-mcp` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.tokens` | `superboard-mcp` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-mcp/data-sources/superboard-mcp.data_source.tool_receipts` | `superboard-mcp` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-observability/health` | `superboard-observability` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.acknowledge_incident` | `superboard-observability` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.discard_email_dead_letter` | `superboard-observability` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.replay_email_dead_letter` | `superboard-observability` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.resolve_incident` | `superboard-observability` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-observability/commands/superboard-observability.command.retry_custom_job` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.incidents` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_custom_jobs` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_email_operations` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.platform_status` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.runtime_metrics` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-observability/data-sources/superboard-observability.data_source.service_health` | `superboard-observability` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-onboardings/health` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_experience` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_targeting_rule` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.create_onboarding_version` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.delete_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.publish_onboarding` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.save_onboarding_placement` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.set_onboarding_experience_status` | `superboard-onboardings` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-onboardings/commands/superboard-onboardings.command.update_onboarding` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_experiences` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_placements` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_statistics` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_targeting_rules` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboarding_versions` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-onboardings/data-sources/superboard-onboardings.data_source.onboardings` | `superboard-onboardings` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-paywalls/health` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.archive_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.archive_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.create_paywall_version` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.publish_paywall_version` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.save_paywall_placement` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.update_paywall` | `superboard-paywalls` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-paywalls/commands/superboard-paywalls.command.update_paywall_experience` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_experiences` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_placements` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_statistics` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywall_versions` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-paywalls/data-sources/superboard-paywalls.data_source.paywalls` | `superboard-paywalls` | `authenticated` |
| `GET` | `/_emdash/api/plugins/superboard-support/health` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.create_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.delete_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.publish_support_article` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.revoke_support_webhook_secret` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.rotate_support_webhook_secret` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.send_inbox_message` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_inbox_conversation` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_configuration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_integration` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_provider` | `superboard-support` | `authenticated` |
| `POST` | `/_emdash/api/superboard/plugins/superboard-support/commands/superboard-support.command.update_support_settings` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_conversations` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.inbox_messages` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_articles` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_assistant_tasks` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_categories` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_channels` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_folders` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_integrations` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_portals` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_providers` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.support_settings` | `superboard-support` | `authenticated` |
| `GET` | `/_emdash/api/superboard/plugins/superboard-support/data-sources/superboard-support.data_source.unified_inbox_items` | `superboard-support` | `authenticated` |
| `GET` | `/superboard-system/health` | `superboard-site` | `public` |
