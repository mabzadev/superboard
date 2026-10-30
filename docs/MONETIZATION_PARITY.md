# Monétisation : périmètre et validation

Le périmètre demandé couvre le catalogue, les offres, les packages, les clients,
les abonnements et les droits d’accès pour Apple, Google et Stripe sur le web.
La fiche client affiche aussi le pays, la langue, la plateforme et les versions
remontées par le SDK. Les paywalls, les tests A/B et les analyses avancées restent
dans leurs plugins propriétaires.

## Catalogue des achats

Les vues Produits, Offres et Droits d’accès utilisent les tables `billing_*`
consultées par le moteur d’achat et les SDK. Une offre contient des packages ;
chaque package associe les produits équivalents des stores. Un package accepte
au plus un produit par store et environnement. Son retrait conserve les produits
et les transactions. L’offre courante est définie par emplacement.

Les vues affichent un catalogue unique, celui utilisé par les achats et les SDK.
Le sélecteur de l’ancien catalogue `products` a été retiré. Les données de cet
ancien catalogue restent conservées, sans import automatique : elles peuvent
appartenir à une intégration distincte et leurs identifiants ne sont pas
nécessairement des identifiants de stores. Les données de démonstration ne
prouvent pas la disponibilité d’un produit dans un store.

Les relations produit–droit sont appliquées aux acheteurs existants lors d’une
modification. Le moteur recalcule les sources d’accès : un remboursement ou une
promotion révoquée ne retire pas un autre achat valide. Un changement de formule
recalcule aussi les droits de la formule précédente. Un consommable explicitement
associé à un droit ouvre cet accès sans expiration, jusqu’à une révocation ou un
remboursement applicable.

Ces concepts correspondent aux [offres RevenueCat](https://www.revenuecat.com/docs/offerings/overview)
et aux [droits d’accès RevenueCat](https://www.revenuecat.com/docs/getting-started/entitlements).
Il ne s’agit pas d’une compatibilité avec le protocole ou les SDK RevenueCat.

## Activer Stripe sur le web

1. Appliquez la migration API `0070_stripe_web_purchases.sql` et la migration
   de manifests du Site. La migration API rétablit le support Stripe retiré par
   `0050_remove_stripe.sql`, en conservant les données des autres stores.
2. Sélectionnez les données de test dans Monétisation, puis ouvrez
   **Paramètres → Passerelles → Paiements web Stripe**.
3. Enregistrez la clé secrète Stripe de test, le secret de signature de son
   webhook et l’origine HTTPS de votre application. Les URL de retour doivent
   appartenir à cette origine. HTTP est accepté uniquement sur une adresse locale.
4. Dans Stripe, configurez l’adresse affichée, précédée de l’origine de votre API
   publique, et activez `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` et
   `charge.refunded`.
5. Testez la connexion, puis utilisez **Produits → Synchroniser les prix Stripe**.
   Le catalogue utilise les identifiants `price_…`. La synchronisation importe les
   prix actifs par unité avec un montant déterminé ; les tarifs par paliers ne
   font pas partie de ce parcours.
6. Associez les produits aux droits d’accès et aux packages de l’offre.
7. Vérifiez un achat, un renouvellement, une annulation et un remboursement en
   mode test avant de configurer séparément les clés de production.

Les secrets sont chiffrés dans le domaine d’exécution de Billing et ne sont pas
renvoyés au navigateur. Le serveur vérifie le corps brut et la signature du
webhook, puis interroge Stripe pour connaître l’état actuel. L’accès ne dépend
pas du retour du navigateur sur la page de succès.

Le [SDK Web](../sdks/web/src/client.d.ts) expose les méthodes suivantes sur
`SuperBoardClient`, après authentification :

- `getPurchaseOfferings(placement)` récupère les offres du catalogue.
- `createCheckoutSession({ product_id, success_url, cancel_url }, idempotencyKey)`
  ouvre une session Stripe pour un produit du catalogue. Réutilisez la même clé
  lors d’une relance de la même tentative.
- `getPurchaseCustomerInfo()` vérifie la signature ES256 et renvoie les droits
  contenus dans la preuve signée.
- `createBillingPortalSession(returnUrl)` ouvre le portail du client Stripe lié
  au compte, pour gérer ses moyens de paiement et abonnements.

Utilisez l’origine API configurée pour ces appels ; le client utilise le préfixe
`/api/v1/sdk/purchases/v2`. Le portail Stripe doit être
configuré dans le compte Stripe. Les options de modification de formule et
les moyens de paiement proposés dépendent de cette configuration.

Références : [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[portail client](https://docs.stripe.com/api/customer_portal/sessions/create),
[vérification des signatures](https://docs.stripe.com/webhooks/signature).

## Informations client

Le serveur conserve le dernier contexte SDK connu dans les attributs du client,
en préservant les autres attributs de l’application. Les valeurs sont bornées
et limitées au pays, à la langue, à la plateforme, à la version de l’application,
à la version du SDK et au storefront.

Le pays provient du contexte réseau reçu par le serveur. Une exécution locale
peut ne pas fournir de pays. Flutter transmet la langue de la plateforme ; Web
utilise `navigator.language`, avec une option `language` explicite. L’option Web
`appVersion` fournit la version de l’application. Ces informations décrivent le
contexte observé ; elles ne constituent pas une preuve d’identité.

## Défauts reproduits pendant l’analyse

- Les anciennes vues Produits et Offres administraient un catalogue différent
  de celui retourné par les achats mobiles.
- La création d’un package n’était pas accessible dans l’ancienne page Offres.
- La modification d’un package d’achat n’avait pas de route serveur.
- Une création d’offre en doublon pouvait effacer le choix de l’offre courante.
- L’association tardive d’un produit à un droit ne mettait pas à jour ses acheteurs.
- Un accès promotionnel révoqué pouvait masquer un achat actif du même droit.
- Un changement de formule pouvait laisser actif le droit de la formule précédente.
- Les champs génériques de configuration du plugin n’étaient pas la configuration
  Apple/Google consultée par la vérification des achats. Les passerelles renvoient
  vers les configurations des applications et permettent de tester la connexion.

Les tests de régression sont dans
[`catalog-management.runtime.test.ts`](../tests/checks/plugins/superboard-monetization/billing/runtime/catalog-management.runtime.test.ts),
[`stripe.runtime.test.ts`](../tests/checks/plugins/superboard-monetization/billing/runtime/stripe.runtime.test.ts)
et [`mobile-catalog.test.tsx`](../tests/checks/plugins/superboard-monetization/front/mobile-catalog.test.tsx).
Les tests Stripe utilisent une vraie base D1 locale et simulent les réponses HTTP
externes. Ils ne certifient pas un compte Stripe réel. Les tests Web vérifient
notamment les preuves CustomerInfo modifiées et les en-têtes du contexte SDK.

## Validation avant publication

La validation Apple/Google sur appareils, les webhooks publics, les clés de
production et un achat Stripe de test sur le compte cible restent nécessaires.
Le [protocole Purchases](SUPERBOARD_PURCHASES.md) décrit les scénarios mobiles.
Aucun paiement réel, déploiement distant ou publication de SDK n’est effectué
par ces tests locaux.

## Vérifications locales du 24 septembre 2026

- 25 tests Billing dans le runtime Workers : catalogue, changements de formule,
  droits multiples, consommables, contexte SDK, Stripe et reprise de migration.
- 24 tests frontend Monétisation et 60 tests ciblés du moteur d’achat réussis.
- 55 tests Flutter réussis ; contrôle Web, construction et tests du package réussis.
  Les 7 tests du client Web ont été relancés après l’ajustement des chemins SDK.
- 2 parcours d’intégration des API du Site réussis.
- Vérification TypeScript du dépôt réussie, puis vérification des API et des
  types des tests Billing après les derniers ajustements.
- Création et relecture d’un produit, d’une offre, d’un package et d’un droit dans
  les données de test du navigateur. Affichage des offres en anglais, de Stripe
  en français, et des nouveaux champs client dans les deux langues vérifié.
- Migrations API et Site appliquées uniquement aux bases locales. Manifests et
  compatibilité des plugins régénérés ; serveur local redémarré et vérifié.

Le contrôle initial du dépôt signalait 70 diagnostics de lint. Les contrôles
ciblés finaux ne signalent aucun diagnostic supplémentaire sur les fichiers
modifiés. Le lint global n’est pas déclaré réussi : ses diagnostics antérieurs
restent à traiter hors de cette refonte.
