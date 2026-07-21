import { Env } from '../types';

type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type MailResult = {
  provider: string;
  id?: string;
};

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function providerFor(env: Env): string | null {
  const configured = env.MAIL_PROVIDER?.trim().toLowerCase();
  if (configured) return configured;
  if (env.RESEND_API_KEY) return 'resend';
  if (env.POSTMARK_SERVER_TOKEN) return 'postmark';
  if (env.SENDGRID_API_KEY) return 'sendgrid';
  if (env.MAIL_WEBHOOK_URL) return 'webhook';
  return null;
}

function mailFrom(env: Env): string {
  return env.MAIL_FROM || 'OpenGrow <noreply@opengrow.io>';
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText || `HTTP ${response.status}`;
  try {
    const parsed: any = JSON.parse(text);
    return parsed?.message || parsed?.error || parsed?.errors?.[0]?.message || text;
  } catch {
    return text;
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json().catch(() => ({}));
}

export async function sendMail(env: Env, message: MailMessage): Promise<MailResult> {
  const provider = providerFor(env);
  if (!provider) {
    throw new Error('Mail provider is not configured');
  }

  const from = mailFrom(env);

  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    const payload = await postJson('https://api.resend.com/emails', {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    }, {
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { provider, id: payload?.id };
  }

  if (provider === 'postmark') {
    if (!env.POSTMARK_SERVER_TOKEN) throw new Error('POSTMARK_SERVER_TOKEN is not configured');
    const payload = await postJson('https://api.postmarkapp.com/email', {
      'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
    }, {
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      MessageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
    });
    return { provider, id: payload?.MessageID };
  }

  if (provider === 'sendgrid') {
    if (!env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY is not configured');
    const payload = await postJson('https://api.sendgrid.com/v3/mail/send', {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    }, {
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: from.match(/<([^>]+)>/)?.[1] || from },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    });
    return { provider, id: payload?.id };
  }

  if (provider === 'webhook') {
    if (!env.MAIL_WEBHOOK_URL) throw new Error('MAIL_WEBHOOK_URL is not configured');
    const headers: Record<string, string> = {};
    if (env.MAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${env.MAIL_WEBHOOK_TOKEN}`;
    const payload = await postJson(env.MAIL_WEBHOOK_URL, headers, {
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { provider, id: payload?.id };
  }

  throw new Error(`Unsupported mail provider: ${provider}`);
}

export function dashboardBaseUrl(env: Env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, '');
  if (env.REACT_HOST) {
    const protocol = env.REACT_HOST_PROTOCOL || 'https://';
    return `${protocol}${env.REACT_HOST}`.replace(/\/$/, '');
  }
  return 'https://app.opengrow.io';
}

function publicUrl(env: Env, path: string, token: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, dashboardBaseUrl(env));
  url.searchParams.set('token', token);
  return url.toString();
}

export function passwordResetUrl(env: Env, token: string): string {
  return publicUrl(env, env.REACT_HOST_CHANGE_PASSWORD_PATH || '/new_password', token);
}

export function invitationUrl(env: Env, token: string): string {
  return publicUrl(env, env.REACT_HOST_ACCEPT_INVITE_PATH || '/accept-invite', token);
}

export function passwordResetMessage(env: Env, to: string, token: string): MailMessage {
  const url = passwordResetUrl(env, token);
  const safeUrl = htmlEscape(url);
  return {
    to,
    subject: 'Reset your OpenGrow password',
    text: `Reset your OpenGrow password using this link: ${url}\n\nThis link expires in 6 hours.`,
    html: [
      '<p>Use the link below to reset your OpenGrow password.</p>',
      `<p><a href="${safeUrl}">Reset your password</a></p>`,
      '<p>This link expires in 6 hours.</p>',
    ].join(''),
  };
}

export function invitationMessage(env: Env, to: string, token: string): MailMessage {
  const url = invitationUrl(env, token);
  const safeUrl = htmlEscape(url);
  return {
    to,
    subject: 'You have been invited to OpenGrow',
    text: `Accept your OpenGrow invitation using this link: ${url}`,
    html: [
      '<p>You have been invited to join a OpenGrow workspace.</p>',
      `<p><a href="${safeUrl}">Accept invitation</a></p>`,
    ].join(''),
  };
}

export function downloadFileMessage(_env: Env, to: string, fileName: string, url: string): MailMessage {
  const safeUrl = htmlEscape(url);
  const safeName = htmlEscape(fileName);
  return {
    to,
    subject: 'Data export - opengrow',
    text: `Your requested OpenGrow export is ready to download: ${url}\n\nThis link expires in 24 hours.`,
    html: [
      '<p>Your requested file is now available for download.</p>',
      `<p><strong>${safeName}</strong></p>`,
      `<p><a href="${safeUrl}">Download File</a></p>`,
      '<p>This link expires in 24 hours.</p>',
    ].join(''),
  };
}
