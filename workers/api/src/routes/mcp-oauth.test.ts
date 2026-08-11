import { describe, expect, it } from 'vitest';
import { configuredMcpConsentUrl } from './mcp-oauth';

describe('MCP OAuth consent configuration', () => {
  it('derives the consent page only from the target-owned Dashboard origin', () => {
    expect(configuredMcpConsentUrl({ APP_URL: 'https://dashboard.example.test/' }))
      .toBe('https://dashboard.example.test/mcp/authorize');
    expect(configuredMcpConsentUrl({
      APP_URL: 'https://dashboard.example.test',
      MCP_CONSENT_URL: 'https://operators.example.test/consent',
    })).toBe('https://operators.example.test/consent');
  });

  it('fails closed without configuration or with an insecure remote origin', () => {
    expect(() => configuredMcpConsentUrl({})).toThrow('not configured');
    expect(() => configuredMcpConsentUrl({ APP_URL: 'http://dashboard.example.test' }))
      .toThrow('absolute HTTPS URL');
  });
});
