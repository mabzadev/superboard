export type Env = Cloudflare.Env;

export type SupportQueueJob = (
  | {
      type: 'support.webhook.dispatch';
      projectId: number;
      eventId: string;
      eventName: string;
      payload: Record<string, unknown>;
    }
  | {
      type: 'support.provider.event.received.v1';
      projectId: number;
      endpointId: string;
      provider: string;
      eventRecordId: string;
    }
  | {
      type: 'support.provider.oauth.exchange.v1';
      projectId: number;
      endpointId: string;
      provider: string;
      oauthStateId: string;
      authorizationCode: string;
    }
  | {
      type: 'support.message.retry.v1';
      projectId: number;
      conversationId: string;
      messageId: string;
    }
  | {
      type: 'support.notification.deliver.v1';
      projectId: number;
      notificationId: string;
    }
  | {
      type: 'support.provider.delivery.send.v1';
      projectId: number;
      deliveryId: string;
    }
  | {
      type: 'support.knowledge.index.v1';
      projectId: number;
      sourceType: string;
      sourceId: string;
    }
  | {
      type: 'support.captain.task.v1';
      projectId: number;
      taskId: string;
    }
  | {
      type: 'support.campaign.dispatch.v1';
      projectId: number;
      campaignId: string;
    }
  | {
      type: 'support.export.requested.v1';
      projectId: number;
      exportId: string;
    }
  | {
      type: 'support.import.requested.v1';
      projectId: number;
      importId: string;
    }
  | {
      type: 'support.sla.evaluate.v1' | 'support.report.rollup.v1';
      projectId: number;
      resourceId: string;
    }
  | {
      type: 'support.workflow.action.v1';
      projectId: number;
      resourceId: string;
      action: 'webhook' | 'integration';
      target: string;
      conversationId: string;
    }
) & { scheduledJobId?: string };

export type ActorKind = 'user' | 'agent' | 'system';

export type Actor = {
  id: string;
  kind: ActorKind;
};

export type { ProjectContext } from '@superboard/contracts/project-context';

export type Conversation = {
  id: string;
  project_id: number;
  external_user_id: string;
  status: 'open' | 'pending' | 'closed';
};
