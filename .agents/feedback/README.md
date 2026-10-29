# Journal d'amélioration

Ce répertoire recueille les retours d'usage des skills, capturés pendant les
discussions par `note-mabza`. Il alimente `/improve-mabza`, qui intègre
récursivement les entrées ouvertes puis trace chaque décision.

## Cycle d'une entrée

1. **Capture** — pendant une discussion, le modèle évalue l'idée émergente
   (fonctionnalité à implémenter, concept à conserver, amélioration d'un
   skill, piste écartée) et écrit une entrée `ouvert`.
2. **Intégration** — `/improve-mabza` classe chaque entrée ouverte :
   intégrer, rejeter ou reporter ; applique les changements ; écrit une trace.
3. **Mémoire** — l'entrée devient `integre` ou `rejete`. Elle n'est jamais
   supprimée : les entrées intégrées expliquent pourquoi un skill a changé,
   les rejetées empêchent de re-proposer l'écarté.

## Format

Une entrée par fichier, nommé `AAAA-MM-JJ-<slug>.md`, avec le frontmatter
suivant — `type` parmi `fonctionnalite`, `concept`, `amelioration`, `rejet` ;
`statut` parmi `ouvert`, `integre`, `rejete` :

```yaml
---
date: AAAA-MM-JJ
type: fonctionnalite | concept | amelioration | rejet
cible: <skill ou fichier concerné>
statut: ouvert
---
```

Suivi de quatre sections : **Observation** (la friction, citée), **Contexte**
(où elle est apparue), **Action proposée** (le changement précis) et
**Critère de vérification** (le comportement observable la prochaine fois).

## Les trois propriétés d'un retour dense

- **Locale** — l'entrée nomme le skill ou le fichier précis concerné ;
- **Rapide** — elle s'écrit en cours de discussion, sans interrompre le fil ;
- **Vérifiable** — elle se termine par un critère observable.

Un retour qui ne satisfait pas les trois propriétés n'appartient pas ici.
