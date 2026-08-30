import {
  listSupportResource,
  postSupportAction,
  getSupportAction,
  type SupportCursorPage,
} from "./nativeClient";

export type SupportOperationsHealth = {
  queues: Array<{ queue_name: string; status: string; count: number }>;
  dead_letters: Array<{ status: string; count: number }>;
  providers: Array<{ provider: string; status: string; count: number }>;
  knowledge: Array<{ status: string; count: number }>;
  imports: Array<{ status: string; count: number }>;
  exports: Array<{ status: string; count: number }>;
};

export const getSupportOperationsHealth = (projectRef: string) =>
  getSupportAction<SupportOperationsHealth>(projectRef, "settings/operations");

export type SupportDeadLetter = {
  id: string;
  source_queue: string;
  message_id: string;
  job_type: string | null;
  replayable: boolean;
  attempts: number;
  status: "quarantined" | "discarded";
  received_at: string;
};

export const listSupportDeadLetters = (projectRef: string) =>
  listSupportResource<SupportDeadLetter>(
    projectRef,
    "settings/operations/dead-letters",
    { limit: 50 }
  ) as Promise<SupportCursorPage<SupportDeadLetter>>;

export const replaySupportDeadLetter = (projectRef: string, id: string) =>
  postSupportAction<{ id: string; replayed: true }>(
    projectRef,
    `settings/operations/dead-letters/${encodeURIComponent(id)}/replay`
  );

export const discardSupportDeadLetter = (projectRef: string, id: string) =>
  postSupportAction<{ id: string; discarded: true }>(
    projectRef,
    `settings/operations/dead-letters/${encodeURIComponent(id)}/discard`
  );
