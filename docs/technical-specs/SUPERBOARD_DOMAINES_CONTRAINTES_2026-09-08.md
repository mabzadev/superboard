# SuperBoard : contraintes de regroupement des domaines

Statut : proposition technique du 8 septembre 2026. Cette note recommande **cinq origines canoniques par environnement à court terme**, puis quatre après migration explicite de l’authentification. Elle vérifie les contraintes du code et des protocoles ; elle ne certifie ni les configurations déployées ni les clients encore utilisés. Aucun domaine ni déploiement n’a été modifié.

## Choix entre trois, quatre et cinq origines

Une origine correspond au protocole, à l’hôte et au port. Des routes `/auth` et `/api` sur le même hôte partagent donc une origine. Le nombre d’origines ne détermine pas le nombre de workers ni celui des plugins. [Définition WHATWG des origines](https://html.spec.whatwg.org/multipage/browsers.html#origin).

| Nombre par environnement | Répartition                                                          | Recommandation                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3                        | Console et API ensemble ; fichiers ; liens courts                    | Possible techniquement, mais partage l’origine de la console avec toute l’API. Autre option : intégrer les liens courts dans l’API ; conserver leurs anciennes adresses annule alors la réduction effective. Aucun besoin établi ne justifie ce compromis ici. |
| 4                        | Console ; API comprenant auth, SDK et MCP ; fichiers ; liens courts  | Cible conditionnelle : les contrats d’identité doivent être migrés. Conserver les fichiers et les liens courts séparés répond aux contraintes ci-dessous.                                                                                                      |
| 5                        | Console ; API comprenant SDK et MCP ; auth ; fichiers ; liens courts | Étape recommandée. Elle maintient les contrats de connexion existants tout en regroupant les façades techniques. Elle peut rester durable si l’isolation de l’authentification est souhaitée.                                                                  |

Les adresses canoniques proposées reprennent les deux familles du dépôt.

| Surface                        | MBZA             | Vocostar             |
| ------------------------------ | ---------------- | -------------------- |
| Console                        | `board.mbza.dev` | `grow.vocostar.com`  |
| API                            | `api.mbza.dev`   | `api.vocostar.com`   |
| Authentification à court terme | `auth.mbza.dev`  | `auth.vocostar.com`  |
| Fichiers                       | `files.mbza.dev` | `files.vocostar.com` |
| Liens courts                   | `in.mbza.dev`    | `go.vocostar.com`    |

**Cinq origines canoniques ne signifie pas cinq noms DNS encore accessibles.** Les domaines `sdk.*`, `mcp.*`, `site.*` et `mail.*` peuvent rester des entrées de compatibilité. Leur retrait dépend des clients et des liens existants. Une façade publique conservée peut desservir un runtime regroupé.

## Conditions de retrait de `auth.*`

OIDC exige l’égalité entre l’issuer découvert, l’issuer de la configuration et le champ `iss` des ID tokens. Un issuer comportant un chemin est valide ; passer de `https://auth.…` à `https://api.…/auth` change néanmoins son identité. Une redirection DNS ou HTTP ne transforme pas les jetons déjà émis. Maintenir l’ancien issuer et ses métadonnées, puis migrer les clients, les validations et le cycle de vie des jetons avant retrait. [OpenID Connect Discovery, sections 3 et 4.3](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig).

Dans le dépôt, [la découverte Melody](../../workers/identity/src/melody/handlers/other.ts) dérive issuer et endpoints de `AUTH_SERVER_URL`. [La signature des jetons d’application](../../workers/identity/src/crypto.ts) utilise `OPENGROW_IDENTITY_ISSUER`, aussi vérifié à la réception. Ces deux configurations doivent être inventoriées ; changer seulement la route publique ne suffit pas.

Les passkeys sont liées au **RP ID utilisé à leur création**. Par défaut, celui-ci doit être le hostname courant ou son domaine parent admissible. Une passkey créée pour `auth.mbza.dev` ne devient donc pas une passkey pour `api.mbza.dev`. Un RP ID parent déjà utilisé pourrait rester commun ; le choisir après coup ne convertit pas les anciennes clés. Les « related origins » de WebAuthn permettent certaines réutilisations avec le même RP ID, un document HTTPS `/.well-known/webauthn` sur ce RP ID et des clients compatibles. Ce mécanisme exige de garder le domaine du RP ID joignable ; sa compatibilité doit être vérifiée sur les appareils supportés. [WebAuthn, définition du RP ID et origines associées](https://www.w3.org/TR/webauthn-3/#sctn-related-origins).

[Le calcul du RP ID Melody](../../workers/identity/src/melody/utils/crypto.ts) retourne directement le hostname de `AUTH_SERVER_URL`. La solution de migration doit donc conserver l’ancien parcours de connexion ou organiser un nouvel enregistrement après authentification vérifiée. L’inventaire des passkeys actives et des méthodes de récupération reste à faire.

### Passkeys des opérateurs de la console

Les passkeys EmDash constituent un second périmètre. [Le helper du core](../../packages/core/src/auth/passkey-config.ts) prend le hostname de `siteUrl`, sinon celui de la requête. [La validation des origines autorisées](../../packages/core/src/auth/allowed-origins.ts) accepte ce hostname et ses sous-domaines, pas un hostname frère. Si une clé a été créée pour `site.mbza.dev`, une bascule vers `board.mbza.dev` n’est donc pas couverte par l’ajout d’un `allowedOrigins`. Le même problème existe entre `site.vocostar.com` et `grow.vocostar.com`.

[Le package auth](../../packages/auth/src/config.ts) expose un `passkeys.rpId`, mais les routes passkey du core utilisent leur propre helper. Ne pas considérer cet override comme une migration déjà disponible. **Garder `auth.*` ne préserve pas à lui seul les passkeys des opérateurs.** Avant de rediriger toutes les pages `site.*`, identifier le RP ID effectivement utilisé et conserver un accès fonctionnel aux anciens comptes jusqu’à leur migration.

## MCP sous un chemin de l’API

MCP autorise un endpoint comme `https://api.…/mcp`. Pour ce chemin, publier `/.well-known/oauth-protected-resource/mcp` et/ou annoncer l’URL des métadonnées dans `WWW-Authenticate` avec `resource_metadata` sur la réponse 401. Le protocole prévoit aussi la découverte des issuers comprenant un chemin. Fixer l’identifiant canonique `resource` et vérifier que les jetons sont destinés à ce serveur MCP. Déplacer l’endpoint ne justifie pas d’accepter indistinctement les jetons de toute l’API. [Autorisation MCP, version 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Le champ `authorization_servers` contient des **identifiants d’issuer**. [RFC 9728, section 2](https://www.rfc-editor.org/rfc/rfc9728.html#section-2). [La route actuelle de l’API](../../workers/api/src/routes/well-known.ts) y place une URL `/.well-known/oauth-authorization-server` : vérifier le chemin réellement exposé et corriger ce contrat lors de la consolidation. Garder `mcp.*` comme façade compatible jusqu’à migration des clients et de leurs audiences ; la conformité des versions clientes présentes n’est pas établie par cette note.

## Liens mobiles et fichiers utilisateurs

Conserver `in.mbza.dev` et `go.vocostar.com` évite de modifier les liens déjà envoyés et leurs associations mobiles. Apple exige l’association entre l’application et les domaines déclarés, avec un fichier AASA servi directement sur les domaines concernés. La redirection du fichier AASA n’est pas supportée. Apple permet certaines redirections lors de l’ouverture d’un Universal Link depuis une autre application ; cela ne remplace pas l’association du domaine. [Apple TN3155, hébergement du fichier AASA](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links?changes=_1_8).

Android exige `https://domaine/.well-known/assetlinks.json`, accessible en HTTPS sans redirection et publié sur chaque hôte associé. Les règles dynamiques d’Android 15+ ne peuvent pas étendre les domaines et chemins autorisés par le manifeste installé. Garder DNS, TLS, fichiers d’association et résolution des anciens liens tant que les versions d’applications correspondantes restent supportées. [Associations Android](https://developer.android.com/training/app-links/configure-assetlinks), [limites des règles dynamiques](https://developer.android.com/training/app-links/about).

L’origine `files.*` conserve une séparation pour les fichiers fournis par les utilisateurs. OWASP recommande un hôte distinct pour leur stockage et distribution. Le standard HTML recommande aussi un domaine dédié pour les documents potentiellement hostiles, même lorsqu’une iframe possède un sandbox : une ouverture directe contourne ce sandbox. [OWASP, fichiers téléversés](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html#file-storage-location), [WHATWG, contenu hostile et iframe](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox).

Un sous-domaine reste dans le même site que ses voisins. Éviter les cookies de session avec `Domain=mbza.dev` ou `Domain=vocostar.com`, qui seraient envoyés à `files.*` ; limiter les cookies à leur hôte. Si des documents actifs arbitraires doivent être hébergés, envisager un domaine enregistrable dédié à la place de `files.*`, sans augmenter le nombre de surfaces. [Définition des sites WHATWG](https://html.spec.whatwg.org/multipage/browsers.html#sites), [portée des cookies, RFC 6265](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.3).

L’aperçu d’e-mail peut devenir une page protégée de la console. Le HTML non fiable doit rester dans une iframe isolée ou être servi depuis l’origine de fichiers ; l’authentification de la page ne neutralise pas ce HTML. Ne pas combiner `allow-scripts` et `allow-same-origin` pour du contenu de même origine. [Sandbox HTML](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox).

## Compatibilité des endpoints pendant la bascule

Une redirection générale des anciennes origines n’est pas une stratégie suffisante pour les API, callbacks et SDK.

- Les réponses 301/302 peuvent transformer un POST en GET ; 307/308 préservent sa méthode mais leur suivi automatique reste une décision du client. [RFC 9110, redirections](https://www.rfc-editor.org/rfc/rfc9110.html#name-redirection-3xx).
- Un navigateur utilisant Fetch retire `Authorization` lors d’une redirection vers une autre origine. Le maintien de la méthode ne préserve donc pas l’authentification. [WHATWG Fetch, redirections HTTP](https://fetch.spec.whatwg.org/#http-redirect-fetch).
- Les URI de retour OAuth doivent correspondre exactement aux valeurs enregistrées. Conserver les callbacks existants jusqu’à mise à jour des fournisseurs et achèvement des transactions en cours. Une réponse 307 après soumission d’identifiants peut transmettre le formulaire au client OAuth ; le standard la proscrit dans ce cas et recommande 303. [RFC 9700, sections 2.1 et 4.12](https://www.rfc-editor.org/info/rfc9700/).

Prévoir des façades ou proxys qui répondent aux anciennes URL en conservant méthode, corps, paramètres et contrat d’authentification. Vérifier les signatures de webhooks, cookies, règles CORS, flux persistants et URL signées avec les clients réellement utilisés. Réserver la redirection vers la console canonique aux pages de navigation dont la migration de session et de passkey est validée.

Le passage à quatre origines exige un inventaire des issuers, RP ID, callbacks, clients MCP et applications mobiles, puis des essais de compatibilité sur chaque ancien domaine. La durée de maintien des alias dépend de cet inventaire et de la durée de vie des liens ; aucune date de suppression n’est établie ici.
