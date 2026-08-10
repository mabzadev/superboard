export type Env = Cloudflare.Env;

export type { ProjectContext } from '@opengrow/contracts/project-context';

export type MarketingQueueJob =
  | { type: 'marketing.campaign.dispatch'; projectId: number; campaignId: string }
  | { type: 'marketing.email.deliver'; projectId: number; deliveryId: string }
  | { type: 'marketing.optin.deliver'; projectId: number; subscriberId: string; token: string; outboxId: string };

export type SmtpPublicConfig = {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'plain';
  username: string | null;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
};

export type SmtpSecretConfig = { password: string | null };
