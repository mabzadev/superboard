# Domaines et endpoints publics SuperBoard

La cible `mabza-development` regroupe les API clientes sous `sdk.mabza.dev`.
Cette configuration est présente dans le dépôt ; sa publication sur Cloudflare
et la migration des intégrations externes constituent une étape de déploiement.

| Domaine                   | Usage                                                     |
| ------------------------- | --------------------------------------------------------- |
| `https://sdk.mabza.dev`   | Authentification applicative et API des SDK               |
| `https://board.mabza.dev` | Front SuperBoard, administration EmDash et MCP sur `/mcp` |
| `https://in.mabza.dev`    | Liens courts et fichiers d’association mobile             |
| `https://api.mabza.dev`   | Extensions personnalisées, notamment `/custom/v1/jobs`    |

Les Workers métier communiquent par service bindings. Leurs noms de services
ne nécessitent pas de domaines publics supplémentaires. `auth.mabza.dev` et
`files.mabza.dev`, ainsi que les alias `site.mabza.dev`, `mcp.mabza.dev` et `mail.mabza.dev`, sont déclarés retirés dans la cible.

## API clientes

Les chemins suivants utilisent l’origine `https://sdk.mabza.dev`. Les familles
sont des préfixes ; appeler un préfixe seul ne déclenche pas une opération.

| Famille             | Opérations représentatives                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/v1/auth`          | `POST /register`, `POST /signin/password`, `POST /signin/google`, `POST /signin/apple`, `POST /anonymous`, `POST /refresh`, `POST /logout`, `GET /me`, `PUT /me`, `DELETE /account`                    |
| `/v1/data`          | `POST /events`, `POST /customer-events`, `POST /runtime-policy`, `GET /files`, `POST /files`, `GET /files/:id/content`, `DELETE /files/:id`, `GET /downloads/:ticket`                                  |
| `/v1/monetization`  | `/purchases/*`, `POST /offerings/resolve`, `/paywalls/resolve`, `/paywalls/events`, `/webhooks/*`, `/iap/apple/*`, `/iap/google/*`                                                                     |
| `/v1/communication` | `/preferences`, `/marketing/tracking/*`, `/marketing/opt-in/:token`, `/email/provider-webhooks/:id`                                                                                                    |
| `/v1/support`       | `/client/*`, `/widget/*`, `/realtime/:ticket`, `/help-center/*`, `/providers/*`                                                                                                                        |
| `/v1/acquisition`   | `/flows/blocks`, `/flows/workflows`, `/flows/events`, `/flows/survey`, `/flows-realtime/block-updates`, `/onboardings/resolve`, `/onboardings/events`, `/attribution`, `/create_link`, `/link_details` |
| `/v1/analytics`     | `POST /events`, `POST /remote-config/resolve`, `/metrics_for_link/:path`, `/metrics_for_project`                                                                                                       |

`POST /v1/data/events` accepte le contrat partagé décrit dans
[la collecte du core](CORE_COLLECTION.md). `/customer-events` conserve le format
des événements clients App ; `/device-events` conserve celui des lots du SDK
historique. Les événements unitaires de ce SDK utilisent `/v1/data/event`.
Ces formats restent distincts. La collecte partagée fonctionne quand Analytics
est désactivé ; les opérations métier restent soumises à leur plugin propriétaire.

Le contrat Purchases v2 est accessible sous `/v1/monetization/purchases`,
notamment `/offerings`, `/customer-info`, `/stripe/checkout` et `/stripe/portal`.
Les clés de vérification des achats restent sur `/.well-known/purchases-jwks.json`.

L’authentification hébergée utilise `/v1/auth/oauth2/v1/*`,
`/v1/auth/identity/v1/*`, `/v1/auth/embedded-auth/v1/*` et
`/v1/auth/saml/sp/v1/*`. La découverte OIDC et ses clés sont sous
`/v1/auth/.well-known/`. Les jetons applicatifs ES256 utilisent le jeu de clés
`/v1/auth/.well-known/application-jwks.json`, distinct des clés OIDC hébergées.

Les méthodes, corps, en-têtes SDK, signatures de fournisseurs et règles
d’autorisation des opérations restent ceux de leurs handlers. Le registre
`packages/contracts/src/route-registry.ts` enregistre les déclarations auprès des handlers et relie les
chemins publics à ces handlers. Le diagnostic de déploiement présente les
chemins canoniques.

## Migration des clients et fournisseurs

Déployez le serveur qui reconnaît `/v1` avant de distribuer les SDK mis à jour.
Configurez leur origine sur `https://sdk.mabza.dev`. Pour FlutterFlow, les
origines `apiBaseUrl`, `filesBaseUrl`, `sdkBaseUrl` et `authGatewayBaseUrl`
pointent vers ce domaine. `customApiBaseUrl` pointe vers `https://api.mabza.dev`.
Le client Support prend `https://sdk.mabza.dev/v1/support/client`.
Le widget Web peut être configuré avec le préfixe `/v1/support/widget`.
Les chemins `/v1/communication/support/*` et `/api/v1/support*` reconnus restent
des alias. La configuration du plugin Support affiche uniquement ses routes
canoniques `/v1/support` et `/v1/support/*`.

Les anciennes routes clientes reconnues restent des alias sur le domaine SDK.
Les routes d’administration continuent de passer par `board` et sa session
opérateur. Le domaine `api` refuse les routes SuperBoard, hormis son contrôle
de santé ; son contrat d’extension reste `/custom/v1/*`.

La migration de domaine exige de reconfigurer les callbacks OAuth, webhooks
Apple, Google, Stripe, Support et Email, ainsi que les origines autorisées des
applications. Le changement d’issuer impose une reconnexion des utilisateurs.
Les liens de téléchargement signés émis après la migration utilisent
`https://sdk.mabza.dev/v1/data/downloads/:ticket`. Les anciens liens utilisant
un domaine retiré doivent être réémis.

La déclaration `retiredDomains` sert au contrôle du déploiement : elle ne
supprime pas les entrées DNS à elle seule. Vérifiez la configuration des
fournisseurs et la disponibilité des routes avant de retirer les anciens
domaines. Aucun changement de schéma de données n’est requis par ce routage.

## Validation locale

Le scénario isolé utilise le Worker API réel et une base SQLite en mémoire.
Démarrez son serveur, puis exécutez le parcours navigateur dans un second terminal.

```sh
pnpm routing:test:browser
node tests/e2e/site/sdk-routing.mjs
```

Le parcours vérifie la collecte durable en français et en anglais avec les
plugins désactivés, et le refus des routes sur les mauvais domaines. Il ne
contacte aucun fournisseur et ne modifie pas la base de l’instance locale.
