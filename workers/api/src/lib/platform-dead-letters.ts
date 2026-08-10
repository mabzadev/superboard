import { DEAD_LETTER_MAX_RECORDS, deadLetterPayload } from "@opengrow/contracts/dead-letter";

type QueueMessageLike = {
  id: string;
  body: unknown;
  attempts: number;
};

export async function quarantinePlatformDeadLetter(
  db: D1Database,
  sourceQueue: string,
  message: QueueMessageLike,
) {
  const payload = await deadLetterPayload(message.body);
  const id = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO platform_dead_letters
      (id,source_queue,message_id,job_type,payload_json,payload_sha256,payload_bytes,replayable,attempts)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    id,
    sourceQueue,
    message.id,
    payload.jobType,
    payload.payloadJson,
    payload.payloadSha256,
    payload.payloadBytes,
    payload.replayable ? 1 : 0,
    message.attempts,
  ).run();
  await db.prepare(`
    DELETE FROM platform_dead_letters WHERE id IN (
      SELECT id FROM platform_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `).bind(DEAD_LETTER_MAX_RECORDS).run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}
