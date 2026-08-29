# Preuve de parité — première slice `supbrd-plug-user`

Cette note lie la Release Front de l’issue #53 aux comportements historiques EmDash. Elle ne déclare aucun cutover : le Dashboard historique et `/_emdash/admin` restent disponibles.

## Matrice de parité

| Surface Release Front | Équivalent historique | Comportement conservé | Limite volontaire de la slice |
| --- | --- | --- | --- |
| `/login` | `/_emdash/admin/login` (`packages/admin/src/router.tsx`) | La connexion opérateur passe exclusivement par la session Passkey EmDash. Le renderer renvoie vers cette route ; aucun JWT applicatif n’est accepté. | Le plugin ne possède ni credential ni session opérateur. |
| `/app` | shell `/_emdash/admin` | Le layout racine est `emdash.core.renderer.admin_shell`; son ABI est vérifiée avant montage et une incompatibilité ferme la surface. | Aucun retrait ou remplacement du Dashboard historique. |
| `/app/profile` | identité de la session EmDash | L’id, le nom, l’e-mail, le rôle et l’état proviennent de `Astro.locals.user`, donc de la session opérateur déjà authentifiée. | La mutation du profil demeure décrite par la Command contribution et sera câblée à son Store cible lors du cutover de données. |
| `/app/users` | `/_emdash/admin/users` (`packages/admin/src/routes/users.tsx`) | L’accès est deny-by-default, exige `users.read`, et la table affiche les utilisateurs lus depuis la source EmDash existante pendant la coexistence. | La migration d’autorité vers le Store dédié appartient à #54. |

## Propriétés vérifiées

- `supbrd-plug-user` exporte des contributions, jamais une URL, une page ou une navigation finale. Les quatre routes et leur Présentation sont composées par la Release Front.
- Le SuperBoard Plugin Manifest utilise le contrat fermé commun de `supbrd-core`. Son checksum d’artefact et ceux des Renderer, Command, Data Source, Schema et Store Descriptors sont calculés sur leur contenu JSON canonique.
- Les trois renderers passent par une registry typée unique. Les props de login, profil et membres sont discriminées par `kind`; aucun routage par suffixe d’identifiant n’est utilisé.
- Les messages du plugin sont fournis en anglais et en français. La Release transporte les deux catalogues.
- Un crash d’un renderer de plugin retourne l’état isolé `error`. Une ABI incompatible du vrai descriptor `emdash.core.renderer.admin_shell` refuse le montage racine.

## Reçus et octets immuables

Le test D1 `apps/site/runtime-tests/user-slice.runtime.test.ts` compile les octets d’une seule `FrontReleaseInput`, persiste le même candidate, crée son preview, lie la réauthentification forte et l’approbation au checksum du candidate, active ce même candidate, puis relit les reçus d’activation. Les identifiants de preuve du scénario sont :

- candidate `01J00000000000000000000404` ;
- release `01J00000000000000000000405` ;
- preview `user-slice-runtime-preview` ;
- reçu de réauthentification `user-slice-runtime-reauth` ;
- activation `user-slice-runtime-activation`.

Le test échoue si les Validation Receipts ne sont pas tous `passed`, si l’approbation ne correspond pas aux octets du candidate, si le preflight n’est pas valide ou si les reçus D1 ne correspondent pas au pointeur activé.

## Preuve visuelle locale

Le contrat visuel des quatre routes est regroupé dans `apps/site/tests/visual/user-slice.html`; les captures light/dark versionnées sont `apps/site/tests/visual/user-slice-light.png` et `apps/site/tests/visual/user-slice-dark.png`. En complément, la route de preview réelle `/superboard-preview/:previewId/login` a été ouverte dans le navigateur local contre le candidate D1 et a monté `supbrd-plug-user.renderer.login_form`. Les routes authentifiées restent volontairement protégées par une vraie session opérateur ; aucun bypass de capture n’a été ajouté.

Commandes de reproduction :

```sh
pnpm --filter @superboard/supbrd-plug-user test
pnpm --filter @superboard/site test
pnpm --filter @superboard/site build
```
