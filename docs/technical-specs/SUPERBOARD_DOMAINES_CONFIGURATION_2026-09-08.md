# Domaines et remontée de configuration SuperBoard

Choix utilisateur du 8 septembre 2026 : six sous-domaines canoniques par instance et un endpoint MCP sous la console. Ce choix remplace la partie domaines de la proposition de simplification. Le regroupement des plugins reste une proposition distincte.

| Usage             | MBZA                         | Vocostar                         |
| ----------------- | ---------------------------- | -------------------------------- |
| Console et EmDash | `board.mbza.dev`             | `board.vocostar.com`             |
| API custom        | `api.mbza.dev`               | `api.vocostar.com`               |
| Authentification  | `auth.mbza.dev`              | `auth.vocostar.com`              |
| Fichiers          | `files.mbza.dev`             | `files.vocostar.com`             |
| Liens courts      | `in.mbza.dev`                | `in.vocostar.com`                |
| SDK               | `sdk.mbza.dev`               | `sdk.vocostar.com`               |
| MCP               | `https://board.mbza.dev/mcp` | `https://board.vocostar.com/mcp` |

## Sources de configuration

`deploy/targets/mbza-development.json` et `deploy/targets/vocostar.json` définissent les domaines, les workers et les environnements. `domainAliases` conserve les anciennes adresses pour préparer la migration ; ces alias ne sont pas comptés parmi les six noms canoniques. Leur déclaration ne constitue pas une preuve de rattachement dans Cloudflare.

Le compilateur produit une projection publique de la configuration, son empreinte et la variable `SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON` pour le Site et l’API. Cette projection sélectionne explicitement les champs affichables. Elle n’exporte ni les secrets ni les valeurs arbitraires des variables des workers.

La page **EmDash → Settings → Configuration** se trouve à `/_emdash/admin/plugins/supbrd-plug-settings/configuration`. Les paramètres du front, `/project-settings`, affichent également les adresses et un lien vers cette page. L’accès exige la permission opérateur `settings:manage`.

La page interroge le worker API avec le bridge opérateur signé. Le worker renvoie ses routes Hono enregistrées et la configuration qu’il a chargée. Le Site refuse de mélanger deux cibles ou environnements. Si la découverte distante échoue, il affiche la configuration déclarée avec un état d’indisponibilité des routes, sans annoncer un déploiement vérifié. Le résumé du front se recharge toutes les 30 secondes.

## Mobile, web et API custom

Le mobile et le web utilisent les mêmes routes applicatives. Les origines web autorisées regroupent `applicationIdentity.webOrigins`, la console, l’authentification et les alias de console. La page affiche la liste CORS effectivement chargée par l’API. L’authentification et le contexte projet restent appliqués par les handlers SDK ; un en-tête de plateforme ne confère pas de permission.

Les routes custom standard sont disponibles sous `https://api.…/custom/v1`, avec le même contrôle SDK de projet et d’identité que le parcours existant. Les routes historiques sous `/api/v1/sdk/custom/v1` restent compatibles. Les fonctions communes du SDK utilisent `sdk.…`. Les anciennes routes API nécessaires au front et aux clients existants restent disponibles pendant la transition.

Le catalogue affiché est produit à partir des routes enregistrées dans les routeurs API et SDK, et non d’une liste de liens écrite dans l’interface. Il indique méthode, URL, entrée worker et clients concernés. Les routes internes et les handlers exécutables ne sont pas sérialisés. Les handlers délégués peuvent exposer un motif de route ; le catalogue ne prétend pas décrire les détails internes de chaque service distant.

## MCP sur la console

Le Site possède le domaine `board.*` et intercepte exactement `/mcp`, `/mcp/health` et `/.well-known/oauth-protected-resource/mcp` avant l’authentification EmDash. Il transmet la requête au binding `MCP_SERVICE`. Le profil regroupé traduit ce binding vers le point d’entrée `SuperboardMcp` du worker API.

Le proxy conserve Bearer, les en-têtes MCP, la méthode, le corps et la réponse en flux. Il retire les cookies de console. Une requête MCP sans jeton reçoit le challenge du serveur MCP ; elle n’est pas redirigée vers une connexion EmDash. La navigation d’un navigateur HTML sur l’ancienne page de gestion `/mcp` est redirigée vers `/system/mcp`. Le parcours de consentement `/mcp/authorize` reste distinct.

Le serveur distingue l’origine de l’URL complète de ressource. La découverte canonique et `WWW-Authenticate` indiquent `https://board.…/.well-known/oauth-protected-resource/mcp`. Le modèle existant de validation des jetons est conservé ; ce changement d’URL ne constitue pas une refonte complète de l’autorisation MCP.

## Mise en service

Aucun déploiement ni changement DNS n’est effectué par ces modifications locales. Les passkeys opérateur et les liens mobiles existants doivent être pris en compte avant de retirer `site.*`, `grow.vocostar.com` ou `go.vocostar.com`. Les alias de compatibilité permettent de préparer cette transition. Vocostar conserve son routage public en préparation et son bridge de production bloqué.

Les scripts de génération et de tests se lancent avec RTK selon les consignes du dépôt. Les configurations de `deploy/generated/` sont des sorties ; modifier les manifestes de cible pour changer les valeurs de référence.

## Vérification locale

Les tests de domaines, de projection, de compilation des cibles et de regroupement des workers passent. Les tests ciblés du Site, de l’API et du MCP vérifient notamment la découverte automatique d’une nouvelle route, le blocage d’un plugin custom désactivé sur les deux chemins d’API, le challenge MCP et l’actualisation du résumé en français.

Les vérifications de types du Site, de l’API, du MCP et des packages de front passent. Le lint rapide ne signale aucun diagnostic. Le lint complet retrouve exactement les trois diagnostics présents avant ces modifications, dans `plugin-front-menu-integration.test.tsx`, `vite-config.ts` et `bundle.test.mjs`.

La suite `scripts/cloudflare-services.test.mjs` compte 26 tests réussis et un échec préexistant : son attente Vocostar ne comprend pas le binding `VOCOSTAR_NOTIFICATION_DISPATCHER`, déjà produit par le générateur avant ce changement.

La page native EmDash a été vérifiée dans le navigateur, avec les adresses, noms de workers et routes chargés depuis l’API locale. La dernière vérification visuelle du résumé front n’a pas été possible dans le navigateur ; son affichage et son actualisation ont été testés en DOM. Les contrôles HTTP locaux confirment le refus d’accès anonyme à la configuration et les réponses MCP de découverte, santé et authentification. Ils ne valident pas un déploiement public ni un parcours OAuth complet.
