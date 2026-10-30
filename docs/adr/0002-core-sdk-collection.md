---
status: accepté
date: 2026-09-24
---

# Collecte SDK possédée par le core

Le core possède les événements bruts collectés auprès des SDK. Leur acceptation
et leur conservation ne dépendent pas des plugins métier actifs. Chaque plugin
lit le journal du core, sélectionne les événements utiles et conserve son propre
curseur ainsi que ses projections. Une désactivation suspend la consommation ;
une réactivation permet de reprendre la lecture.

Cette décision précise la frontière de l’[ADR 0001](0001-plugin-autonomy-and-operator-session.md) :
les plugins restent propriétaires de leurs traitements, données métier et vues,
mais les événements SDK partagés appartiennent au core. Les commandes métier
authentifiées, comme un achat ou un message de support, restent exécutées par
leur propriétaire. Un montant déclaré par un SDK ne constitue pas un achat
vérifié.

La lecture différée rend les statistiques éventuellement cohérentes. Chaque
consommateur avance son curseur après une écriture durable et déduplique les
relectures. L’effacement d’un compte retire aussi ses événements du journal,
afin que les consommateurs ne puissent pas les recréer depuis ce journal.

Le [contrat de collecte](../CORE_COLLECTION.md) décrit les API et l’ordre de mise
à niveau.
