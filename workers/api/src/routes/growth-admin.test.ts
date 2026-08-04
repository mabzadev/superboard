import { describe, expect, it } from 'vitest';
import { requireGrowthWriteAccess } from './growth-admin';

describe('Growth administration access', () => {
  it('allows project members to read Growth data', () => {
    expect(() => requireGrowthWriteAccess('GET', 'member')).not.toThrow();
    expect(() => requireGrowthWriteAccess('HEAD', 'member')).not.toThrow();
  });

  it('allows owners and administrators to change Growth configuration', () => {
    expect(() => requireGrowthWriteAccess('POST', 'owner')).not.toThrow();
    expect(() => requireGrowthWriteAccess('PATCH', 'admin')).not.toThrow();
    expect(() => requireGrowthWriteAccess('DELETE', 'owner')).not.toThrow();
  });

  it('blocks project members from changing Growth configuration', () => {
    expect(() => requireGrowthWriteAccess('POST', 'member')).toThrowError(
      'Owner or admin access is required to change Growth configuration',
    );
    expect(() => requireGrowthWriteAccess('DELETE', 'member')).toThrowError(
      'Owner or admin access is required to change Growth configuration',
    );
  });
});
