# Billing Worker — isolation et bascule contrôlée

## État actuel

Le domaine financier est déployé dans le Worker privé `opengrow-billing`. Il n'a ni route publique ni sous-domaine `workers.dev`. `opengrow-api` est son seul point d'entrée, au moyen d'un service binding Cloudflare.

Le trafic d'achat reste volontairement en mode `local` tant que la gate Apple, Google, Stripe et l'inventaire RevenueCat ne sont pas validés. Le Worker privé est donc prêt, mais il ne constitue pas encore le chemin de production des achats.

L'état non sensible est observable via :

```text
GET https://go.vocostar.com/health/billing
```

La réponse doit indiquer `ready_for_traffic: true`, `credential_copies_ready: true` et `credential_decryption_ready: true`. Elle ne doit jamais contenir une clé, un certificat ou un contenu d'identifiants Store.

## Frontières d'autorité

- `api-auth-gateway` sur `api.vocostar.com` reste l'unique autorité d'authentification de l'application VocoStar.
- OpenGrow vérifie le JWT ES256 émis par cette autorité. Il ne crée pas une seconde identité utilisateur.
- `opengrow-billing` est l'unique composant autorisé à exécuter les écritures financières une fois la bascule activée.
- Le dashboard, Messaging, Reputation et Growth n'écrivent jamais directement dans les projections d'entitlements.
- RevenueCat reste actif jusqu'à la réussite complète de la matrice d'achats et de l'import des clients réels.

## Flux

```text
FlutterFlow / SDK
  -> opengrow-api (JWT api-auth-gateway)
  -> service binding privé
  -> opengrow-billing
  -> Apple / Google
  -> billing_events + projections

Stripe Web
  -> webhook opengrow-api (signature vérifiée, corps borné)
  -> événement durable + queue billing
  -> opengrow-billing
  -> billing_events + projections
```

Les webhooks répondent après vérification et mise en file. Le traitement métier, les reprises et la DLQ sont asynchrones et idempotents.

## Secrets du Worker Billing

Noms attendus uniquement :

- `APPLE_ROOT_CERTIFICATES_B64` ;
- `OPENGROW_VOCOSTAR_WEBHOOK_SECRET` ;
- `PURCHASES_SIGNING_KEYSET` ;
- `STORE_CREDENTIALS_ENCRYPTION_KEYS`.

Les identifiants Apple et Google sont stockés dans D1 avec un chiffrement propre au domaine Billing (`billing-v1`). Les colonnes historiques restent lisibles uniquement par l'API en mode local pendant la transition. La migration de chiffrement est auditée dans `billing_credential_rewrap_audit` et ne journalise jamais le clair.

Les secrets temporaires de re-chiffrement et d'administration doivent être créés seulement pendant une rotation contrôlée, puis supprimés immédiatement après vérification. Ils ne sont pas requis en fonctionnement normal.

## Gate avant bascule

Ne pas changer `BILLING_EXECUTION_MODE` en `service` avant que tous les points suivants soient verts :

1. Produits `vocostar_weekly_999` et `vocostar_yearly_4999` approuvés et achetables.
2. Apple Sandbox/TestFlight : achat, pending, restauration, renouvellement, expiration, remboursement, fermeture et perte réseau.
3. Google License Testing/Internal : mêmes scénarios, y compris acknowledgement/finalisation.
4. Stripe Test Mode : Checkout Web, renouvellement, échec, portail, remboursement et litige.
5. Doublons et événements hors ordre sans double entitlement.
6. Réconciliation OpenGrow, Stores, Stripe et miroir VocoStar sans divergence.
7. Inventaire et import de tous les abonnements RevenueCat réels.
8. Tests FlutterFlow sur appareils iOS et Android avec reprise de l'outbox.
9. DLQ vide, alertes actives et sauvegarde D1 récente vérifiée.

## Procédure de bascule

1. Sauvegarder D1 et enregistrer les versions Worker API/Billing déployées.
2. Exécuter `npm run billing:check`, `npm run worker:check` et la matrice appareils.
3. Vérifier `/health/billing` et les quatre secrets attendus par leur nom.
4. Déployer d'abord `opengrow-billing`, puis `opengrow-api` avec `BILLING_EXECUTION_MODE=service`.
5. Exécuter un achat sandbox de chaque Store, une restauration et un événement Stripe Test.
6. Surveiller taux de validation, latence, événements en attente, retries, DLQ et divergences.
7. Conserver RevenueCat pendant la fenêtre d'observation prévue ; son retrait est une livraison distincte.

## Rollback

En cas d'anomalie, redéployer l'API avec `BILLING_EXECUTION_MODE=local`. Ne pas modifier les événements immuables et ne pas supprimer les messages de queue : ils servent au replay après correction. Si nécessaire, restaurer séparément la version du Worker Billing et la sauvegarde D1 prise avant bascule.

Le rollback de routage ne change jamais l'autorité d'identité : `api-auth-gateway` demeure la seule source d'authentification VocoStar.
