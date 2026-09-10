import { EMAIL_SERVICE_SEND_PATH } from '@superboard/contracts/email'
import type { EmailServiceMessage } from '@superboard/contracts/email'
import {
  IMailer, SendEmailOptions,
} from './interface'

async function idempotencyKey (message: SendEmailOptions): Promise<string> {
  const bytes = new TextEncoder().encode([
    message.email.trim().toLowerCase(),
    message.subject,
    message.content,
  ].join('\n'))
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes,
  )
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(
      2,
      '0',
    ))
    .join('')
  return `identity:melody:v1:${hex}`
}

/**
 * Delivers Melody transactional mail through SuperBoard's private Email
 * Worker. That Worker owns the AWS SES SMTP socket, retries, dead letters and
 * provider-event accounting, so Identity never opens a network SMTP socket.
 */
export class SuperboardMailer extends IMailer {
  async sendEmail (message: SendEmailOptions): Promise<Response> {
    const body: EmailServiceMessage = {
      kind: 'transactional',
      idempotencyKey: await idempotencyKey(message),
      to: message.email,
      subject: message.subject,
      html: message.content,
      metadata: {
        source: 'identity',
        engine: 'melody-auth',
        senderName: message.senderName,
      },
    }

    return this.context.env.EMAIL_SERVICE.fetch(
      `https://email.internal${EMAIL_SERVICE_SEND_PATH}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.context.env.EMAIL_INTERNAL_TOKEN,
        },
        body: JSON.stringify(body),
      },
    )
  }
}
