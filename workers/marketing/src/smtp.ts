import {
  EmailTransportError,
  buildMessage,
  sendSmtpMessage as sendWithSharedTransport,
} from "@opengrow/email-transport";
import type { SmtpPublicConfig, SmtpSecretConfig } from "./types";
import { failure } from "./auth";

type SmtpMessage = {
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
};

export { buildMessage };

export async function sendSmtpMessage(
  config: SmtpPublicConfig,
  secret: SmtpSecretConfig,
  message: SmtpMessage,
): Promise<{ messageId: string; response: string }> {
  try {
    return await sendWithSharedTransport(config, secret, message);
  } catch (error) {
    if (error instanceof EmailTransportError) {
      throw failure(error.code, error.message, error.status, error.details);
    }
    throw error;
  }
}
