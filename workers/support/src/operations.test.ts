import { describe, expect, it, vi } from 'vitest';
import { sendBulkJob } from './operations';

describe('Support operations bulk dispatch', () => {
  it('awaits a JSON job on the dedicated bulk queue', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const job = {
      type: 'support.import.requested.v1',
      projectId: 12,
      importId: 'import-1',
    };

    await sendBulkJob({ send } as unknown as Queue, job);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(job, { contentType: 'json' });
  });

  it('propagates a queue failure so the persisted job can be marked failed', async () => {
    const send = vi.fn().mockRejectedValue(new Error('queue unavailable'));

    await expect(sendBulkJob({ send } as unknown as Queue, {
      type: 'support.export.requested.v1',
      projectId: 12,
      exportId: 'export-1',
    })).rejects.toThrow('queue unavailable');
  });
});
