# OpenGrow Messaging

## Autorité d'identité

`api-auth-gateway` sur `https://api.vocostar.com` est l'unique autorité d'authentification de
l'application VocoStar. Messaging ne crée ni compte, ni session, ni jeton. Le client échange son jeton
VocoStar existant via `POST /auth/opengrow-token`; le Worker Messaging vérifie ensuite le JWT ES256
court avec le JWKS public du gateway, l'issuer `https://api.vocostar.com` et l'audience `opengrow`.

## Isolation

- Worker : `opengrow-messaging`
- Domaine : `https://messages.vocostar.com`
- D1 : `opengrow-messaging-db`
- R2 : `opengrow-messaging`
- Durable Object : `ConversationRoom`, une instance nommée par conversation
- Dashboard : l'API OpenGrow appelle Messaging par service binding et capacité interne rotative

Le Worker Billing ne dépend d'aucun de ces composants.

## Garanties

- `client_conversation_id` et `client_message_id` rendent les retries idempotents.
- Réutiliser un id de message avec un contenu différent renvoie `idempotency_conflict`.
- Le Durable Object attribue une séquence persistante et diffuse les événements par WebSocket hibernant.
- Une pièce jointe R2 ne peut être associée qu'à sa conversation d'origine.
- Les statuts, priorités, labels, assignations et actions sont audités dans un journal immuable.
- Les erreurs publiques exposent `code`, `message`, `retryable` et `request_id`.

## FlutterFlow

La bibliothèque `sdks/flutterflow_messaging` est distincte de Purchases. Son initialisation appelle
uniquement `api-auth-gateway`, puis elle expose les conversations, messages, upload et WebSocket sans
alourdir le SDK financier.
