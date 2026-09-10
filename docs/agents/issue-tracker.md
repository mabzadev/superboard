# Suivi des tickets : GitHub

Les tickets et spécifications sont des issues GitHub dans
`mabzadev/superboard`. Utilisez `gh` via RTK.

Ajoutez `--repo mabzadev/superboard` aux commandes `gh issue` et `gh pr`
pour éviter toute ambiguïté avec le dépôt EmDash amont.

## Opérations

- Lire : `rtk proxy gh issue view <numéro> --repo mabzadev/superboard --comments`.
- Lister : `rtk proxy gh issue list --repo mabzadev/superboard --state open --json number,title,body,labels`.
- Créer : `rtk proxy gh issue create --repo mabzadev/superboard --title "<titre>" --body-file <fichier.md>`.
- Commenter : `rtk proxy gh issue comment <numéro> --repo mabzadev/superboard --body-file <fichier.md>`.
- Étiqueter : `rtk proxy gh issue edit <numéro> --repo mabzadev/superboard --add-label "<étiquette>"`.
- Retirer une étiquette : utilisez `--remove-label`.
- Réclamer : `rtk proxy gh issue edit <numéro> --repo mabzadev/superboard --add-assignee @me`.
- Fermer : `rtk proxy gh issue close <numéro> --repo mabzadev/superboard`.

Préparez les corps multilignes dans un fichier Markdown et utilisez
`--body-file`. Consultez `triage-labels.md` pour les rôles de triage.

## Pull requests comme source de demandes

**PR comme source de demandes : non.**

Les PR externes sont exclues de la file de triage.
Si cette option est activée ultérieurement, utilisez les opérations
`gh pr` et retenez les associations d’auteur `CONTRIBUTOR`,
`FIRST_TIME_CONTRIBUTOR` et `NONE`, obtenues via l’API GitHub.

Pour une référence numérique ambiguë, essayez `gh pr view`, puis
`gh issue view` si ce n’est pas une PR.

## Opérations d’orientation

Pour les skills comme `wayfinder` :

- La carte est une issue `wayfinder:map` contenant Notes,
  Décisions jusqu’à présent et Brouillard.
- Les enfants sont des sous-tickets GitHub. À défaut, utilisez une
  liste de tâches dans la carte et « Fait partie de #<carte> » chez l’enfant.
- Les types utilisent `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling` ou `wayfinder:task`.
- Utilisez les dépendances natives GitHub pour les blocages ;
  à défaut, indiquez « Bloqué par : #<numéro> ».
- Sélectionnez le premier enfant ouvert sans bloqueur ouvert ni responsable.
- À la résolution, consignez le résultat, fermez le ticket et ajoutez
  son lien avec l’essentiel de la décision dans la carte.
