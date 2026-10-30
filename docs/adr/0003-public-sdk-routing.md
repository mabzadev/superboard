---
status: accepté
date: 2026-09-24
---

# Trois domaines SuperBoard et une origine pour les extensions

Les applications clientes utilisent `sdk.<domaine>/v1`, avec les familles
`auth`, `data`, `monetization`, `communication`, `acquisition` et `analytics`.
Le Front et l’administration restent sur `board.<domaine>`, et les liens courts
sur `in.<domaine>`. `api.<domaine>` est réservé aux extensions personnalisées.

Cette décision modifie les domaines publics et les chemins des SDK. Elle
préserve les autorités métier et la session opérateur de l’[ADR 0001](0001-plugin-autonomy-and-operator-session.md),
ainsi que la collecte du core de l’[ADR 0002](0002-core-sdk-collection.md).
Le dispatch traduit les chemins avant les contrôles des plugins ; la collecte
partagée ne devient pas une dépendance d’Analytics.

Les anciennes routes clientes sont conservées comme alias sur `sdk` pendant
la migration. Les consommateurs doivent changer d’origine avant le retrait
des anciens domaines. Les SDK qui emploient les chemins canoniques nécessitent
le serveur correspondant. Les callbacks, webhooks et issuers externes doivent
être migrés lors du déploiement, selon le [contrat public](../PUBLIC_ENDPOINTS.md).
