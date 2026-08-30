# Suivi des tickets : GitHub

Les tickets et spécifications de ce dépôt sont enregistrés comme issues GitHub dans `mabzadev/superboard`. Utilisez la CLI `gh` pour toutes les opérations.

## Conventions

- **Créer un ticket** : `gh issue create --title "..." --body "..."`. Utilisez un heredoc pour les corps multilignes.
- **Lire un ticket** : `gh issue view <number> --comments`. Récupérez également ses étiquettes et filtrez les commentaires avec `jq` lorsque nécessaire.
- **Lister les tickets** : `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, avec les filtres `--label` et `--state` appropriés.
- **Commenter** : `gh issue comment <number> --body "..."`
- **Ajouter une étiquette** : `gh issue edit <number> --add-label "..."`
- **Retirer une étiquette** : `gh issue edit <number> --remove-label "..."`
- **Fermer** : `gh issue close <number> --comment "..."`

Le dépôt est normalement déduit de `git remote -v`. Depuis ce clone, `gh` doit résoudre `mabzadev/superboard` automatiquement.

## Pull requests comme source de demandes

**PR comme source de demandes : non.**

Les pull requests externes ne font pas partie de la file de triage par défaut. Modifiez cette valeur en `oui` uniquement si le dépôt décide ultérieurement de traiter les PR externes comme des demandes fonctionnelles.

Lorsque cette option est activée, utilisez les équivalents `gh pr` :

- **Lire une PR** : `gh pr view <number> --comments` puis `gh pr diff <number>`.
- **Lister les PR externes** : `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`.
- Conservez uniquement les associations `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` et `NONE`.
- Écartez `OWNER`, `MEMBER` et `COLLABORATOR`.
- **Commenter, étiqueter ou fermer** : utilisez `gh pr comment`, `gh pr edit` et `gh pr close`.

GitHub partage la même séquence numérique entre issues et pull requests. Pour résoudre une référence ambiguë comme `#42`, essayez `gh pr view 42`, puis utilisez `gh issue view 42` si ce n’est pas une PR.

## Lorsqu’une compétence indique « publier sur le système de suivi des problèmes »

Créez une issue GitHub dans `mabzadev/superboard`.

## Lorsqu’une compétence indique « récupérer le ticket correspondant »

Exécutez `gh issue view <number> --comments`.

## Opérations d’orientation

Ces conventions sont utilisées par les compétences d’orientation telles que `wayfinder`.

- **Carte** : une issue unique portant l’étiquette `wayfinder:map`, avec les sections Notes, Décisions jusqu’à présent et Brouillard.
- **Création d’une carte** : `gh issue create --label wayfinder:map`.
- **Ticket enfant** : une issue liée à la carte comme sous-ticket GitHub.
- Si les sous-tickets GitHub ne sont pas disponibles, ajoutez l’enfant à une liste de tâches dans le corps de la carte et placez `Fait partie de #<carte>` au début de son corps.
- Les tickets enfants utilisent une étiquette `wayfinder:<type>` où le type est `research`, `prototype`, `grilling` ou `task`.
- **Blocage** : utilisez les dépendances natives GitHub lorsque disponibles.
- Pour ajouter une dépendance, exécutez `gh api --method POST repos/mabzadev/superboard/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
- `<blocker-db-id>` doit être l’identifiant numérique de base de données obtenu avec `gh api repos/mabzadev/superboard/issues/<number> --jq .id`.
- Si les dépendances natives ne sont pas disponibles, placez `Bloqué par : #<n>, #<n>` au début du corps.
- **Requête de frontière** : listez les enfants ouverts, puis écartez ceux qui possèdent un bloqueur ouvert ou un responsable. Le premier ticket restant dans l’ordre de la carte est sélectionné.
- **Réclamation** : `gh issue edit <number> --add-assignee @me`.
- **Résolution** : commentez la réponse, fermez le ticket, puis ajoutez à la carte un pointeur contenant l’essentiel et le lien vers le ticket.
