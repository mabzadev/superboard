import { describe, expect, it } from 'vitest';
import { parseEvents, validateDefinition } from './contracts';

describe('onboardings contracts v1', () => {
  it('accepts completion telemetry', () =>
    expect(
      parseEvents({
        project_id: 'p1',
        events: [
          {
            id: 'e1',
            type: 'complete',
            placement: 'first-run',
            occurred_at: '2026-01-01T00:00:00Z',
          },
        ],
      }).events,
    ).toHaveLength(1));

  it('bounds event batches', () =>
    expect(() => parseEvents({ project_id: 'p1', events: [] })).toThrow(
      '1 to 100',
    ));

  it('accepts explicit optional marketing consent blocks', () => {
    const definition = validateDefinition({
      screens: [
        {
          id: 'preferences',
          blocks: [
            {
              id: 'newsletter',
              type: 'marketing_consent',
              props: {
                title: 'Product news',
                body: 'Transactional mail is independent.',
                list_ids: ['product-news'],
                attributes: { source: 'onboarding' },
              },
            },
          ],
        },
      ],
    });
    expect(definition.screens[0].blocks).toHaveLength(1);
  });

  it('rejects bundled, preselected or malformed marketing consent', () => {
    for (const props of [
      { default: true },
      { required: true },
      { list_ids: ['duplicate', 'duplicate'] },
      { list_ids: [''] },
    ]) {
      expect(() =>
        validateDefinition({
          screens: [
            {
              id: 'preferences',
              blocks: [{ type: 'marketing_consent', props }],
            },
          ],
        }),
      ).toThrow();
    }
  });
});
