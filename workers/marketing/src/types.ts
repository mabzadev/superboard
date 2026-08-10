export type Env = Cloudflare.Env;

export type { ProjectContext } from "@opengrow/contracts/project-context";
export type {
  EmailSmtpPublicConfig as SmtpPublicConfig,
  EmailSmtpSecretConfig as SmtpSecretConfig,
} from "@opengrow/contracts/email";

export type MarketingQueueJob =
  | {
      type: "marketing.campaign.dispatch";
      projectId: number;
      campaignId: string;
    }
  | { type: "marketing.email.deliver"; projectId: number; deliveryId: string }
  | {
      type: "marketing.optin.deliver";
      projectId: number;
      subscriberId: string;
      token: string;
      outboxId: string;
    };
