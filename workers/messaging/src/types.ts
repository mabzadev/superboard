export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  CONVERSATIONS: DurableObjectNamespace;
  ENVIRONMENT: string;
  AUTH_GATEWAY_ISSUER: string;
  AUTH_GATEWAY_AUDIENCE: string;
  AUTH_GATEWAY_JWKS_URL: string;
  ALLOWED_PROJECT_IDS: string;
  CORS_ORIGIN: string;
  INTERNAL_API_TOKEN: string;
}

export type ActorKind = 'user' | 'agent' | 'system';

export type Actor = {
  id: string;
  kind: ActorKind;
};

export type Conversation = {
  id: string;
  project_id: number;
  external_user_id: string;
  status: 'open' | 'pending' | 'closed';
};
