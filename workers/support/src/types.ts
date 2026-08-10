export type Env = Cloudflare.Env;

export type SupportQueueJob = {
  type: 'support.webhook.dispatch';
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

export type { ProjectContext } from '@opengrow/contracts/project-context';

export type Conversation = {
  id: string;
  project_id: number;
  external_user_id: string;
  status: 'open' | 'pending' | 'closed';
};
