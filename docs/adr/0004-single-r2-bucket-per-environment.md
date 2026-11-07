---
status: accepté
date: 2026-11-07
---

# Un bucket R2 par environnement, un dossier par module

Chaque environnement SuperBoard stocke tous ses objets R2 dans un seul bucket :
`superboard-files` pour le développement de `mabza-development`,
`superboard-local-files` en local et `superboard-<target>-<env>-files` pour une
installation. Chaque module écrit sous son dossier, défini par `R2_FOLDERS` dans
`@superboard/contracts/r2` :

| Dossier      | Propriétaire                                              |
| ------------ | --------------------------------------------------------- |
| `site/`      | Site EmDash : médias et sauvegardes JSON automatiques     |
| `files/`     | API, Billing et Files : fichiers d'application et exports |
| `support/`   | Support : pièces jointes et exports                       |
| `analytics/` | Analytics : archive d'événements et exports               |
| `marketing/` | Marketing : médias de campagne                            |
| `flows/`     | Flows : exports, archives et lettres mortes               |
| `backups/`   | Installateur : sauvegardes D1 chiffrées de la production  |

Les Workers gardent leurs bindings, qui pointent tous vers le même bucket. Ils
passent chaque binding dans `scopedR2Bucket()`, qui ajoute le dossier aux clés
et le retire des résultats de `list()`. Le Site passe le même dossier à l'option
`prefix` de l'adaptateur `r2()` d'EmDash. Les clés enregistrées en base restent
relatives au dossier.

Le dossier devient la frontière du Store de plugin. Un binding R2 donne accès
au bucket entier : cette frontière repose sur le code des Workers, et non plus
sur les permissions de Cloudflare. Les sauvegardes de production partagent donc
le bucket des Workers qui ont accès aux fichiers.

Le bootstrap crée une seule fois un bucket partagé par plusieurs ressources du
manifeste. Les manifestes qui déclarent encore un bucket par module restent
valides ; leurs Workers écrivent alors dans le dossier de leur module, à
l'intérieur de chaque bucket. Les objets écrits à la racine avant ce changement
ne sont plus lus.
