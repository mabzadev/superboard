const fixture = require('../../../../packages/contracts/fixtures/emdash-store-parity/v1.json');

describe('EmDash Store authority compatibility', () => {
  it('preserves the same React Native response and instance aliases', () => {
    expect(fixture.after).toEqual(fixture.before);
    expect(fixture.aliases.projectId).toBe(fixture.instance_id);
    expect(fixture.aliases.pid).toBe(fixture.instance_id);
  });
});
