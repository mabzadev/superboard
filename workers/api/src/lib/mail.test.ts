import { describe, expect, it, vi } from 'vitest';
import { Env } from '../types';
import { sendMail } from './mail';

describe('Cloudflare email delivery', () => {
  it('sends a composed message through the Email Sending binding', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'message-123' });
    const env = {
      EMAIL: { send },
      MAIL_PROVIDER: 'cloudflare',
      MAIL_FROM: 'OpenGrow <noreply@vocostar.com>',
    } as unknown as Env;

    const result = await sendMail(env, {
      to: 'owner@example.com',
      subject: 'Reset your password',
      text: 'Plain text',
      html: '<p>HTML</p>',
    });

    expect(send).toHaveBeenCalledWith({
      from: { name: 'OpenGrow', email: 'noreply@vocostar.com' },
      to: 'owner@example.com',
      subject: 'Reset your password',
      text: 'Plain text',
      html: '<p>HTML</p>',
    });
    expect(result).toEqual({ provider: 'cloudflare', id: 'message-123' });
  });

  it('auto-detects Cloudflare when the binding is present', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'message-456' });
    const env = {
      EMAIL: { send },
      MAIL_FROM: 'noreply@vocostar.com',
    } as unknown as Env;

    await sendMail(env, {
      to: 'owner@example.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@vocostar.com',
      to: 'owner@example.com',
    }));
  });
});
