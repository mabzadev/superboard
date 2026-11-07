---
status: accepté
date: 2026-11-07
---

# Primitives backend dans le Worker Data

Les tables, les fichiers, le temps réel, les fonctions et les vecteurs des
applications clientes appartiennent au plugin Data et s'exécutent dans son
Worker. Les tables applicatives sont de vraies tables SQL de la D1 du Worker
Data, nommées `adb_<projectId>_<table>`. Elles ne réutilisent pas les
collections EmDash du Contenu, qui restent un modèle éditorial chargé sur la
base du Site.

Chaque table, bucket et collection de vecteurs déclare une règle par
opération : `public`, `authenticated`, `owner` ou `service`. Le Worker Data
applique ces règles lui-même, à partir du contexte de projet signé par le Worker
API, du jeton d'accès d'application ou d'une clé serveur `sb_secret_…`. Une
ligne invisible répond `404`.

Le temps réel utilise un Durable Object par projet. Les fonctions des
Opérateurs s'exécutent avec le Worker Loader, déjà utilisé par le Site pour les
plugins sandboxed, sans abonnement Workers for Platforms. La recherche
vectorielle utilise un index Vectorize par environnement, découpé en espaces de
noms par projet et par collection, avec un index de métadonnées `owner`.

Cette décision précise l'[ADR 0001](0001-plugin-autonomy-and-operator-session.md) :
le plugin Data reste l'Autorité d'écriture de ces données. Elle conserve la
famille `/v1/data` de l'[ADR 0003](0003-public-sdk-routing.md) et le dossier
`files/` de l'[ADR 0004](0004-single-r2-bucket-per-environment.md). La
[spécification](../technical-specs/SUPERBOARD_BACKEND_PRIMITIVES_2026-11-07.md)
décrit les contrats et les limites.
