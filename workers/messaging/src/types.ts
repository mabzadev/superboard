export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  CONVERSATIONS: DurableObjectNamespace;
  MESSAGING_QUEUE: Queue<MessagingQueueJob>;
  ENVIRONMENT: string;
  AUTH_GATEWAY_ISSUER: string;
  AUTH_GATEWAY_AUDIENCE: string;
  AUTH_GATEWAY_JWKS_URL: string;
  ALLOWED_PROJECT_IDS: string;
  CORS_ORIGIN: string;
  QUEUE_NAME: string;
  DLQ_NAME: string;
  INTERNAL_API_TOKEN: string;
  INTERNAL_API_TOKEN_PREVIOUS?: string;
}

export type MessagingQueueJob = {
  type: 'messaging.webhook.dispatch';
  projectId: number;
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
};

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
