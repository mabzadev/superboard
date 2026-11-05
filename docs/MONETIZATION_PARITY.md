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

## Restauration et transfert des achats

**Paramètres → Général** propose les trois comportements de restauration de
RevenueCat pour tout le projet : transférer au nouvel identifiant (par défaut),
transférer s’il n’y a pas d’abonnement actif, et garder l’identifiant d’origine.
Ils s’appliquent aux restaurations et aux achats envoyés par les SDK. Un achat
appartenant à un identifiant anonyme fusionne cet identifiant avec le nouveau.
Chaque transfert apparaît dans l’historique des deux fiches client, avec
l’identifiant d’origine et le nouvel identifiant. Le comportement détaillé est
décrit dans [Restore behavior](SUPERBOARD_PURCHASES.md#restore-behavior) ;
la référence est la page
[Restore Behavior de RevenueCat](https://www.revenuecat.com/docs/projects/restore-behavior).

Comme dans RevenueCat :

- **Utiliser un autre comportement pour le bac à sable** applique un autre des
  trois comportements aux achats que le store déclare en bac à sable. Sans ce
  réglage, ils suivent le comportement du projet. Appliquez la migration API
  `0075_billing_sandbox_restore_behavior.sql`, qui ajoute la colonne
  `sandbox_restore_behavior`.
- Un propriétaire ou un administrateur transfère les achats App Store et Google
  Play d’un client vers un autre depuis la fiche client (**Transférer les
  achats**, recherche de l’identifiant de destination, puis confirmation). Le
  transfert ignore le comportement de restauration, apparaît dans l’historique
  des deux fiches et envoie le webhook `TRANSFER`.
- La fusion d’un identifiant anonyme ajoute « Alias créé » à l’historique du
  client, sans webhook (l’événement `SUBSCRIBER_ALIAS` de RevenueCat est
  obsolète).
- Les soldes de monnaie virtuelle restent au client qui les a reçus lors d’un
  transfert.
- Les notifications Google reçues par l’ancienne route `/api/v1/iap/google`,
  sans file de facturation, gardent le propriétaire actuel d’un achat transféré.
- Le SDK Flutter expose le refus par `SuperBoardPurchasesErrorCode.receiptAlreadyInUse`
  et `SuperBoardPurchaseResult.isReceiptAlreadyInUse`.

Écarts restants avec RevenueCat : l’ancien mode de partage entre identifiants
n’est pas proposé ; « abonnement actif » désigne un abonnement du propriétaire
dans le même store et le même environnement, et non le contenu du reçu, car les
SDK envoient une transaction par requête ; le transfert depuis la fiche client
ne déplace ni les achats Stripe ni les droits promotionnels ; le SDK Web
n’appelle ni la restauration ni l’envoi de reçus et n’a donc pas d’erreur
équivalente.

## Devises et devise d’affichage

Comme RevenueCat, chaque achat est converti en USD au taux du jour de l’achat,
et chaque remboursement au taux du jour de sa demande. Les montants d’origine
restent stockés et affichés. Pour un jour sans cotation (week-end, jour férié),
le dernier taux publié avant ce jour s’applique, une fois ce jour connu comme
non coté.

Deux sources gratuites, sans clé d’API, fournissent les taux :

- le taux de référence quotidien de la
  [Banque centrale européenne](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html),
  prioritaire, pour la trentaine de devises qu’elle publie ;
- le taux quotidien de [Currency API](https://github.com/fawazahmed0/exchange-api)
  (`@fawazahmed0/currency-api`, servi par jsDelivr, avec le miroir
  `currency-api.pages.dev`), seulement pour les devises que la BCE ne publie
  pas, comme SAR, AED, VND, EGP, NGN, PKR, QAR ou KZT. Ses taux sont alignés sur
  le dollar de la BCE du même jour, pour conserver le cours de la devise contre
  l’USD donné par Currency API. Son historique commence le 2 mars 2024.

Chaque taux enregistre sa source (`ecb` ou `currency-api`), et le détail d’un
achat l’indique.

1. Appliquez les migrations API `0073_billing_exchange_rates.sql` et
   `0074_billing_operator_display_currency.sql`. La première ajoute les colonnes
   `usd_price_micros` et `usd_rate_date` aux achats du registre et aux
   transactions vérifiées, `usd_amount_micros` et `usd_rate_date` aux
   remboursements, ainsi que la table des taux. La seconde ajoute la devise
   d’affichage de chaque opérateur et le suivi des jours consultés chez
   Currency API. Elle rouvre aussi les montants restés sans conversion faute de
   taux BCE, pour que Currency API les convertisse.
2. La tâche planifiée de Billing (rapprochement toutes les dix minutes) met en
   file `billing.exchange_rates.sync`. Ce travail récupère les nouveaux taux de
   la BCE au plus une fois par heure, charge l’historique manquant par fenêtres
   de 180 jours, puis convertit les montants en attente par lots bornés. Pour
   les devises absentes chez la BCE, il interroge Currency API pour au plus dix
   jours par passage, puis convertit les montants concernés. Il reprend là où il
   s’est arrêté. Une indisponibilité d’une source est enregistrée sans faire
   échouer le travail ; Currency API est de nouveau interrogé une heure plus
   tard.
3. Chaque opérateur choisit sa devise d’affichage dans son profil (menu du
   compte, **Compte → Modifier le profil → Devise d’affichage**) : USD (par
   défaut), EUR, GBP, AUD, CAD, JPY, BRL, KRW, CNY, MXN, SEK ou PLN. Le choix
   suit l’opérateur sur tous les projets et tous les appareils, sans modifier
   l’affichage des autres opérateurs. Sans le plugin Authentification, le choix
   se fait dans **Monétisation → Paramètres → Général**. Le montant en USD est
   converti dans cette devise au taux de la BCE du même jour. Un montant déjà
   dans la devise d’affichage est repris tel quel.

Un montant reste sans conversion lorsque aucune source ne publie sa devise pour
ce jour, par exemple un achat en SAR antérieur au 2 mars 2024. Les totaux et la
série de la page Achats, le revenu net de la Vue d’ensemble et le « Total
dépensé » de la fiche client additionnent uniquement les montants convertis.
Les achats encore sans taux sont comptés à part et signalés à l’écran. L’API
des statistiques ajoute `display_currency`, `totals_in_display_currency` et
`series_in_display_currency` ; le paramètre facultatif `display_currency`
remplace la devise de l’opérateur pour une requête. Le détail d’un achat ajoute
`usd_rate_source`. L’export des transactions ajoute `usd_price_micros` et
`usd_rate_date`.

Le réglage de projet créé par `0073` (`billing_project_currency_settings`)
n’est plus lu : une préférence de compte ne peut pas dépendre du projet ouvert,
et la table ne dit pas quel opérateur avait fait ce choix.

Écarts restants avec RevenueCat : les transactions vérifiées sont converties par
le travail planifié et non au moment de l’achat ; un achat dont la devise n’est
publiée par aucune source reste sans montant converti ; un week-end ou un jour
férié utilise le dernier taux publié par la BCE, y compris pour les devises de
Currency API.

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
