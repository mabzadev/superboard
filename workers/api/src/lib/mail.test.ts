import { describe, expect, it, vi } from 'vitest';
import { Env } from '../types';
import { dashboardBaseUrl, sendMail } from './mail';

describe('Cloudflare email delivery', () => {
  it('delegates transactional mail to the common Email Worker', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'email-123', status: 'captured' }, { status: 202 }));
    const env = {
      EMAIL_SERVICE: { fetch },
      EMAIL_INTERNAL_TOKEN: 'internal-mail-secret',
      MAIL_PROVIDER: 'email-service',
      MAIL_FROM: 'OpenGrow <noreply@mbza.dev>',
    } as unknown as Env;

    const result = await sendMail(env, {
      to: 'owner@example.com',
      subject: 'Reset your password',
      text: 'Plain text',
      html: '<p>HTML</p>',
    });

    expect(fetch).toHaveBeenCalledWith('https://email.internal/internal/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-internal-token': 'internal-mail-secret' }),
    }));
    expect(result).toEqual({ provider: 'email-service', id: 'email-123' });
  });

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

  it('fails closed when a direct provider has no target-owned sender', async () => {
    const env = {
      EMAIL: { send: vi.fn() },
      MAIL_PROVIDER: 'cloudflare',
    } as unknown as Env;

    await expect(sendMail(env, {
      to: 'owner@example.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    })).rejects.toThrow('MAIL_FROM is not configured');
  });

  it('fails closed when no target-owned Dashboard origin is configured', () => {
    expect(() => dashboardBaseUrl({} as Env)).toThrow('APP_URL is not configured');
  });
});
