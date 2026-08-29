# Documentation du domaine

Ce document indique comment les compétences d’ingénierie doivent consommer la documentation de domaine du monorepo SuperBoard.

## Organisation multi-contexte

Le dépôt utilise la disposition suivante :

- `CONTEXT-MAP.md` à la racine : index des contextes et règles de sélection ;
- `CONTEXT.md` à la racine : architecture globale, frontières de la plateforme et vocabulaire transversal ;
- `apps/CONTEXT.md` : applications, Grow Dashboard, interfaces administratives et applications de référence ;
- `workers/CONTEXT.md` : services Cloudflare, Workers métier, stockage, événements et traitements asynchrones ;
- `packages/CONTEXT.md` : contrats, bibliothèques partagées et règles de sérialisation ;
- `sdks/CONTEXT.md` : SDK, widgets, FlutterFlow et intégrations clientes ;
- `docs/adr/` : décisions architecturales qui concernent toute la plateforme ;
- `<contexte>/docs/adr/` ou `<module>/docs/adr/` : décisions limitées à un contexte ou module précis.

Les fichiers de contexte et ADR peuvent être créés progressivement par la compétence de modélisation du domaine. Leur absence ne doit pas bloquer une tâche.

## Avant d’explorer le code

1. Lisez `CONTEXT-MAP.md` lorsqu’il existe.
2. Lisez le `CONTEXT.md` racine pour les concepts transversaux.
3. Sélectionnez les fichiers de contexte qui correspondent au périmètre de la tâche.
4. Lisez les ADR globaux pertinents sous `docs/adr/`.
5. Recherchez ensuite les ADR plus proches du module concerné.

Exemples :

- une tâche Grow lit `CONTEXT.md`, `apps/CONTEXT.md` et les ADR Dashboard pertinents ;
- une tâche Support Worker lit `CONTEXT.md`, `workers/CONTEXT.md` et les ADR sous `workers/support/docs/adr/` lorsqu’ils existent ;
- une modification de contrat lit `CONTEXT.md`, `packages/CONTEXT.md` et les ADR du package concerné ;
- une modification FlutterFlow lit `CONTEXT.md`, `sdks/CONTEXT.md` et les ADR du SDK concerné ;
- une modification qui traverse API, Worker, Dashboard et SDK lit tous les contextes correspondants.

Si un fichier attendu n’existe pas, poursuivez sans demander sa création préalable.

## Utiliser le vocabulaire du glossaire

Lorsqu’une sortie nomme un concept du domaine — dans un ticket, une proposition, un test, un contrat ou un symbole public — utilisez le terme défini par le `CONTEXT.md` pertinent.

Évitez les synonymes que le glossaire exclut explicitement.

Lorsqu’un concept nécessaire ne figure dans aucun glossaire :

- vérifiez d’abord que le terme n’existe pas dans un autre contexte ;
- évitez d’inventer une terminologie concurrente ;
- signalez la lacune à la compétence de modélisation du domaine lorsqu’elle représente un véritable concept métier manquant.

## Signaler les conflits d’ADR

Si une proposition contredit un ADR existant, signalez explicitement le conflit au lieu de remplacer silencieusement la décision.

Format recommandé :

> Contradictoire avec ADR-0007 — la décision mérite toutefois d’être réexaminée parce que…

Une modification d’ADR doit préserver l’historique de la décision et expliquer ce qui a changé.
