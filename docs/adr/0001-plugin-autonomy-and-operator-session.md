---
status: accepté
date: 2026-09-06
---

# Plugins autonomes et session opérateur EmDash

Les plugins possèdent leurs vues, composants, traductions, commandes et données. EmDash assemble les contributions actives et leurs personnalisations. L’identité opérateur, l’accueil minimal, le dispatch et le journal techniques restent accessibles sans plugin métier, afin de pouvoir administrer et réactiver une instance entièrement désactivée.

Le Front utilise la session EmDash et un contexte d’instance et de projet résolu côté serveur. Les identités applicatives et les API externes gardent leurs protocoles distincts. Une erreur de service reste locale à la vue ; une session opérateur expirée seule peut déclencher une nouvelle connexion.

Les intégrations entre plugins sont facultatives. Un fournisseur désactivé refuse les nouveaux appels, y compris ceux reçus par une liaison interne. Son absence ne retire pas les fonctions propres du consommateur. Les vues désactivées sont masquées dans le Front et dans EmDash Views, avec une réponse 404 aux accès directs ; leurs données et personnalisations sont conservées.

Une opération de cycle de vie est sérialisée par instance. Un nouvel artefact et ses preuves sont préparés séparément de l’état actif, puis appliqués avec le changement de Release. Une compensation restaure le pointeur, les états et les preuves précédents. L’expiration du délai d’une tâche ne prouve pas qu’elle a cessé d’écrire.

Le plugin Gateway publie des routes supplémentaires ; le manifeste technique des API actives appartient à la Release. Audit exploite un journal métier facultatif à partir du journal technique. Ces deux plugins peuvent être désactivés sans empêcher l’administration des autres plugins.

L’inventaire gelé conserve les 120 routes et 71 entrées de menu d’origine. Les ajouts restent inventoriés séparément. La présence d’un composant ou d’un handler n’équivaut pas à une validation fonctionnelle : la livraison requiert des preuves de parcours et d’effets persistés, consignées dans le rapport de validation.
