# Vérifier le menu après publication

Depuis un checkout dont les dépendances et les packages du workspace sont déjà
installés et compilés, lancez le parcours avec Node 26 et Chromium Playwright.
Les injections de panne utilisent les groupes de processus POSIX : ce parcours
s’exécute sur macOS ou Linux.
La préparation télécharge le certificat public Apple et vérifie son empreinte,
comme le lanceur local ; cette étape nécessite une connexion réseau.

```sh
node tests/e2e/site/published-menu.mjs
```

La fixture prépare des bases vierges, applique les migrations locales et démarre
le Site EmDash et ses Workers réels. Les ports, noms de Workers, files de messages,
secrets et répertoires temporaires appartiennent à l’exécution. Le scénario
établit et vérifie une session opérateur, puis active les plugins par leurs API.
Chaque activation utilise le workflow existant de compilation, approbation et
publication d’une Release Front.

Le navigateur découvre les liens du menu Front et de ses sous-menus, attend
l’hydratation et les requêtes métier, puis vérifie le contenu de chaque vue en
français et en anglais. L’entrée vers le gestionnaire de plugins est contrôlée ;
les liens internes du menu administratif EmDash relèvent des parcours EmDash.
Une destination sans contrat de contenu échoue. La liste des contrats ne sert
pas de liste de destinations à parcourir.

Les contrôles négatifs ajoutent un lien vers une route absente dans un shell
HTTP 200, présentent un véritable éditeur au contrôle des statistiques,
provoquent une erreur de module client, rendent une table métier indisponible,
puis suspendent le service pendant une requête de statistiques. Les modifications
sont restaurées et les contrôles positifs rejoués. Les processus sont arrêtés
avant la suppression du stockage temporaire.

Le chemin du rapport JSON est affiché à la fin. Son nom par défaut est unique
sous `test-results/`. Pour choisir son emplacement, utilisez une destination
distincte pour chaque exécution concurrente.

```sh
SUPERBOARD_PUBLISHED_MENU_REPORT=/tmp/menu-publication.json \
  node tests/e2e/site/published-menu.mjs
```

Le rapport conserve les activations, la Release attendue et celle observée,
les destinations découvertes, les requêtes, les symptômes et les résultats des
pannes attendues. `coverage.unverified` contient les destinations découvertes
mais non exécutées. Un échec de préparation, de page, de panne attendue ou de
couverture produit un code de sortie non nul.

Les métriques Cloudflare Analytics Engine et les sondes des domaines publics
ne sont pas configurées dans cette instance locale. Le rapport distingue cette
limite des erreurs de ses API métier. Il ne certifie ni les fournisseurs externes
ni la traduction exhaustive des anciens écrans.

Exécutez les tests du calcul de couverture indépendamment des Workers.

```sh
node --test tests/checks/apps/site/published-menu-report.test.mjs \
  tests/checks/apps/site/isolated-instance.test.mjs
```
