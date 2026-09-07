# Validation locale des plugins autonomes

L’inventaire historique reste fixé à 18 plugins, 120 routes et 71 menus. Le rapport inclut séparément la vue `/mcp` et les deux contributions Billing d’import des données historiques.

Le [rapport par scénario](validation-report.json.md) contient 704 vérifications réussies et 383 non vérifiées. Il reste incomplet : une route affichée ou un adaptateur enregistré ne prouve pas toutes ses actions métier. Les entrées sans preuve restent `unverified`.

Les contrôles automatisés suivants ont été exécutés sur le worktree :

| Contrôle | Résultat |
| --- | --- |
| Lint et types globaux | Aucune erreur |
| Core | 6 185 tests réussis ; 9 exclusions prévues par la configuration |
| Admin | 1 760 tests réussis dans le hook complet |
| Site | 71 tests unitaires, 21 tests Front et 116 tests runtime réussis |
| API | 404 tests réussis |
| Billing | 5 tests unitaires, 13 runtime et 16 de configuration réussis |
| Email | 5 tests du transport et 30 du Worker réussis |
| Identity, Files, Observability, MCP et modules | 472 tests réussis |
| Builds Core, Admin et Site | Réussis |
| Générateurs et contrats de parité | 28 tests réussis ; artefacts reproductibles |
| Runner des preuves de parité requises | Réussi, avec React Native, Flutter et FlutterFlow |
| Lockfile gelé | Vérifié sur les 111 projets du workspace |

Les [cycles de vie dans le navigateur](browser-lifecycle-matrix.json) couvrent les 18 plugins. Les Views conservent leurs identifiants après désactivation et réactivation. Le [contrôle des menus](browser-menu-lifecycle.json) vérifie l’actualisation d’un onglet Front déjà ouvert, la disparition puis la restauration des 71 liens historiques, la conservation des autres liens et l’accès au socle. L’état final de la QA contient les 18 plugins actifs.

Les parcours de rendu, rechargement et historique couvrent 117 des 121 routes inventoriées, en combinant [le parcours général](browser-route-continuity.json), [les détails Identity](identity-new-fixture-routes.json) et [le détail utilisateur Flows](flows-user-route-continuity.json). Cette vérification ne démontre pas une traduction intégrale du Front.

Des effets persistés ont été vérifiés pour les liens de campagne, fichiers, entitlements, import Billing, e-mails capturés, invocations et consentements MCP, invitations opérateur et connexions par passkey. Les identifiants et les preuves propres à chaque scénario figurent dans [evidence.json](evidence.json). Le transfert Billing d’achats historiques, sa reprise et les conflits sont couverts par les tests runtime ; l’import par le navigateur utilise une source QA sans achat historique.

Les quatre détails Identity historiques sans fixture restent non vérifiés : utilisateur, journal des e-mails, journal des connexions et journal des SMS. Le signup SDK et le sign-in canonique d’un utilisateur applicatif sont [vérifiés séparément](application-user-signin-proof.json). Ce sujet applicatif ne crée pas automatiquement une entrée dans les anciennes vues Identity/Melody.

La messagerie d’authentification du socle EmDash n’est pas configurée dans cette QA. Les boutons concernés renvoient [`EMAIL_NOT_CONFIGURED`](operator-email-dependency.json). Le canal de capture du plugin Email métier est distinct. L’invitation par lien copié et la connexion opérateur par passkey ont été vérifiées sans envoi externe.

La suite Admin a révélé une course dans son harnais de test du presse-papiers : le menu flottant peut intercepter le clic sur Copy. Le test isolé et le fichier complet de 70 tests passent ; aucune attente ni temporisation n’a été modifiée pour masquer cet échec.

Les preuves excluent les cookies, clés SDK, jetons d’invitation, codes OAuth et clés privées. Les états privés du navigateur et la configuration temporaire QA restent hors du dépôt.
