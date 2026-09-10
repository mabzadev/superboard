# Plugins et services SuperBoard

Les plugins résident dans `packages/plugins/`. Leurs services Cloudflare sont rangés avec eux ; leurs identifiants et leurs regroupements de déploiement restent distincts de leurs chemins source.

Ce contexte définit la place des runtimes métier dans le Site EmDash.

Les tests maintenus des plugins résident dans `tests/checks/plugins/<plugin>/`.
Les cas frontend, unitaires et workerd gardent leurs environnements distincts.
Les scripts d'exploitation et les migrations restent chez leur propriétaire ;
voir [le guide des tests](../../tests/README.md) pour les commandes et les données
partagées.

## Langage

**Worker métier** :
Runtime Cloudflare qui exécute les traitements métier, asynchrones, temps réel ou externes d’un plugin module sans posséder les données autoritatives de l’Instance SuperBoard.
_À éviter_ : source de vérité, plugin full EmDash, page EmDash

**Donnée opérationnelle** :
Donnée EmDash qui décrit un fait, un résultat ou un état d’exécution métier et dont l’Autorité d’écriture appartient au plugin responsable du module.
_À éviter_ : état transitoire de Worker, cache, donnée possédée par un Worker

**État transitoire de Worker** :
État temporaire ou reconstructible qu’un Worker métier utilise pour coordonner une exécution sans devenir une source de vérité.
_À éviter_ : Donnée opérationnelle autoritative, archive, audit métier

**Worker Gateway** :
Worker d’exécution de `supbrd-plugmod-gateway` qui applique les Routes Gateway publiées par EmDash et transmet les commandes aux repositories propriétaires.
_À éviter_ : propriétaire de données métier, configuration de routes cachée dans le code
