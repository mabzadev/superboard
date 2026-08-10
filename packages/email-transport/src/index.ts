export type SmtpPublicConfig = {
  host: string;
  port: number;
  security: "tls" | "starttls" | "plain";
  username: string | null;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
};

export type SmtpSecretConfig = { password: string | null };

export type SmtpMessage = {
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
};

export class EmailTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EmailTransportError";
  }
}

export async function sendSmtpMessage(
  config: SmtpPublicConfig,
  secret: SmtpSecretConfig,
  message: SmtpMessage,
): Promise<{ messageId: string; response: string }> {
  const { connect } = await import("cloudflare:sockets");
  let socket = connect(
    { hostname: config.host, port: config.port },
    {
      secureTransport: config.security === "tls" ? "on" : config.security === "starttls" ? "starttls" : "off",
      allowHalfOpen: false,
    },
  );
  await socket.opened;
  let session = new SmtpSession(socket);
  try {
    await session.expect([220]);
    await session.command(`EHLO ${sanitizeDomain(config.from_email.split("@")[1] || "opengrow.local")}`, [250]);
    if (config.security === "starttls") {
      await session.command("STARTTLS", [220]);
      session.release();
      socket = socket.startTls({ expectedServerHostname: config.host });
      await socket.opened;
      session = new SmtpSession(socket);
      await session.command(`EHLO ${sanitizeDomain(config.from_email.split("@")[1] || "opengrow.local")}`, [250]);
    }
    if (config.username) {
      if (!secret.password) throw error("smtp_password_missing", "SMTP password is missing");
      await session.command(`AUTH PLAIN ${toBase64(`\0${config.username}\0${secret.password}`)}`, [235]);
    }
    await session.command(`MAIL FROM:<${sanitizeMailbox(config.from_email)}>`, [250]);
    await session.command(`RCPT TO:<${sanitizeMailbox(message.to)}>`, [250, 251]);
    await session.command("DATA", [354]);
    const built = buildMessage(config, message);
    await session.write(`${dotStuff(built)}\r\n.\r\n`);
    const accepted = await session.expect([250]);
    await session.command("QUIT", [221]);
    return { messageId: extractMessageId(accepted.text) || built.messageId, response: accepted.text };
  } finally {
    session.release();
    await socket.close().catch(() => undefined);
  }
}

class SmtpSession {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";

  constructor(private readonly socket: Socket) {
    this.reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  }

  async command(value: string, expected: number[]) {
    await this.write(`${value}\r\n`);
    return this.expect(expected);
  }

  async write(value: string) {
    await this.writer.write(new TextEncoder().encode(value));
  }

  async expect(expected: number[]): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    let code = 0;
    while (true) {
      const line = await this.readLine();
      if (!/^\d{3}[ -]/.test(line)) throw error("smtp_protocol_error", "SMTP server returned an invalid response", 502);
      code = Number(line.slice(0, 3));
      lines.push(line.slice(4));
      if (line[3] === " ") break;
      if (lines.length > 100) throw error("smtp_protocol_error", "SMTP response exceeded the allowed size", 502);
    }
    if (!expected.includes(code)) {
      throw error("smtp_rejected", `SMTP server rejected the command (${code})`, code >= 500 ? 422 : 503, { smtp_code: code });
    }
    return { code, text: lines.join("\n").slice(0, 4_000) };
  }

  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      const { done, value } = await this.reader.read();
      if (done) throw error("smtp_connection_closed", "SMTP connection closed unexpectedly");
      this.buffer += new TextDecoder().decode(value, { stream: true });
      if (this.buffer.length > 64_000) throw error("smtp_protocol_error", "SMTP response exceeded the allowed size", 502);
    }
    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index).replace(/\r$/, "");
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }
}

export function buildMessage(config: SmtpPublicConfig, message: SmtpMessage) {
  const messageId = `<${crypto.randomUUID()}@${sanitizeDomain(config.from_email.split("@")[1] || "opengrow.local")}>`;
  const boundary = `opengrow-${crypto.randomUUID()}`;
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `From: ${config.from_name ? `${encodeHeader(config.from_name)} <${sanitizeMailbox(config.from_email)}>` : sanitizeMailbox(config.from_email)}`,
    `To: ${sanitizeMailbox(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    ...(config.reply_to ? [`Reply-To: ${sanitizeMailbox(config.reply_to)}`] : []),
    ...Object.entries(message.headers || {}).map(([name, value]) => `${sanitizeHeaderName(name)}: ${sanitizeHeaderValue(value)}`),
    "MIME-Version: 1.0",
  ];
  let body: string;
  if (message.html && message.text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", normalizeLines(message.text),
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", normalizeLines(message.html),
      `--${boundary}--`,
    ].join("\r\n");
  } else if (message.html) {
    headers.push("Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit");
    body = normalizeLines(message.html);
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit");
    body = normalizeLines(message.text || "");
  }
  return { raw: `${headers.join("\r\n")}\r\n\r\n${body}`, messageId };
}

function error(code: string, message: string, status = 503, details?: Record<string, unknown>) {
  return new EmailTransportError(code, message, status, details);
}

function dotStuff(message: ReturnType<typeof buildMessage>) {
  return message.raw.split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}
function normalizeLines(value: string) { return value.replace(/\r?\n/g, "\r\n"); }
function sanitizeMailbox(value: string) {
  const mailbox = value.trim().toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(mailbox)) throw error("smtp_mailbox_invalid", "SMTP mailbox is invalid", 422);
  return mailbox;
}
function sanitizeDomain(value: string) { return value.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 253) || "opengrow.local"; }
function sanitizeHeaderName(value: string) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(value)) throw error("email_header_invalid", "Email header name is invalid", 422);
  return value;
}
function sanitizeHeaderValue(value: string) { return String(value).replace(/[\r\n]+/g, " ").slice(0, 2_000); }
function encodeHeader(value: string) { return `=?UTF-8?B?${toBase64(sanitizeHeaderValue(value))}?=`; }
function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function extractMessageId(value: string) { return /(?:queued as|id=)\s*<?([^\s>]+)>?/i.exec(value)?.[1] || null; }
