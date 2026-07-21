# OpenGrow Purchases

OpenGrow Purchases est la source de vérité multi-tenant des achats iOS et Android. Les événements envoyés directement par une application restent provisoires. Seule une transaction validée par l’App Store Server API ou l’Android Publisher API peut activer un entitlement.

## Déploiement du Worker

Appliquer les migrations D1 `0007_opengrow_purchases.sql` et `0008_billing_event_ordering.sql`, créer la queue `opengrow-billing` et sa DLQ, puis définir ces secrets Cloudflare :

- `JWT_SECRET` : secret existant du Worker ;
- `STORE_CREDENTIALS_ENCRYPTION_KEYS` : keyring JSON versionné, par exemple `{"2026-01":"…","2026-07":"…"}` ;
- `STORE_CREDENTIALS_ACTIVE_KEY_VERSION` : version utilisée pour les nouvelles écritures ; conserver les anciennes versions pendant la rotation ;
- `PURCHASES_SIGNING_SECRET` : signature de la réponse `CustomerInfo` ;
- `APPLE_ROOT_CERTIFICATES_B64` : tableau JSON contenant les certificats racine DER encodés en base64, téléchargés depuis la section Apple Root Certificates du site Apple PKI.

Ne jamais ajouter les clés `.p8` ou le JSON de service account à `wrangler.toml`. Les téléverser depuis l’assistant de configuration du dashboard. OpenGrow les chiffre en AES-GCM avant D1 et n’écrit plus la clé Apple en clair.

La validation Apple de production exige aussi `app_apple_id`, le bundle ID, le Key ID et l’Issuer ID. La validation Google exige un service account autorisé dans Play Console et l’Android Publisher API activée.

## Identité

Chaque projet peut enregistrer un issuer, une audience et une URL JWKS dans `POST /api/v1/billing/:projectId/oidc`. Pour Vocostar :

```text
iss = https://api.vocostar.com
aud = opengrow
sub = identifiant utilisateur opaque
jwks = https://api.vocostar.com/.well-known/jwks.json
```

Le SDK envoie le JWT dans `Authorization: Bearer …`. Sans JWT il crée un alias `$opengrow_anon_<uuid>`. `logIn` fusionne l’utilisateur anonyme avec le sujet JWT vérifié. La restauration transfère les achats par défaut ; le réglage projet `restore_behavior=block` l’interdit.

## API mobile

Toutes les routes utilisent `PROJECT-KEY`, `PLATFORM`, `IDENTIFIER` et `X-OpenGrow-Anonymous-ID` :

- `GET /purchases/v1/offerings`
- `GET /purchases/v1/customer-info`
- `POST /purchases/v1/identify`
- `POST /purchases/v1/apple/transactions`
- `POST /purchases/v1/google/purchases`
- `POST /purchases/v1/restore`
- `POST /purchases/v1/sync`

Le SDK n’appelle `completePurchase` qu’après validation et persistance serveur. Google est acknowledged ou consumed par le Worker. Une réponse `pending` ne donne aucun droit.

## FlutterFlow

Le package `packages/opengrow_flutterflow` fournit :

- `opengrowInitialize`
- `opengrowPurchase`
- `opengrowRestore`
- `opengrowSync`
- `opengrowHasEntitlement`
- `opengrowGetOfferings`
- `OpenGrowPaywall`
- `OpenGrowRestorePurchasesButton`

Action Flow conseillé pour une page Premium : appeler `opengrowHasEntitlement("premium")`; si faux, ouvrir la page contenant `OpenGrowPaywall`; après un résultat `purchased`, rappeler `opengrowHasEntitlement` puis naviguer.

## Bascule depuis RevenueCat

1. Configurer les mêmes produits et entitlement `premium` dans OpenGrow.
2. Conserver RevenueCat comme initiateur pendant la phase miroir et transmettre les transactions StoreKit 2 / tokens Google à OpenGrow.
3. Comparer tous les comptes sandbox et scénarios (achat, essai, renouvellement, changement de formule, annulation, grâce, remboursement et restauration).
4. Exiger 100 % de concordance et aucune activation depuis `/add_payment_event`.
5. Basculer le paywall FlutterFlow sur OpenGrow, tester TestFlight et Play Closed Testing, puis retirer les actions, dépendances et clés RevenueCat.

## Limite de la première livraison

Les paywalls distants avancés, le ciblage, les expériences A/B, le Customer Center, le win-back et les automatisations Messaging sont le jalon suivant. La source de vérité des achats et les primitives nécessaires à la suppression de RevenueCat sont isolées afin que ces fonctions puissent être ajoutées sans modifier le journal transactionnel.
