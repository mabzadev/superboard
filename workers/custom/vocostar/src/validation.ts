import type { CustomWorkerJob } from "@opengrow/contracts/custom-worker";

export type VoiceCloneInput = {
  fileId: string;
  language: string;
};

export type MediaConvertInput = {
  vocalId: string;
  vocalType: "app" | "user" | "clone";
  mediaType: "video" | "audio" | "text";
  input: Record<string, string>;
  sourceFileId: string | null;
  creditCost: number;
};

export class VocoStarJobError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
  ) {
    super(code);
  }
}

export function parseVoiceClone(job: CustomWorkerJob): VoiceCloneInput {
  const language = stringValue(
    job.payload.language,
    "language",
    8,
  ).toLowerCase();
  if (
    !new Set(["en", "us", "fr", "es", "pt", "de", "it", "ja", "ko"]).has(
      language,
    )
  ) {
    throw new VocoStarJobError("language_invalid");
  }
  return {
    language,
    fileId: fileIdentifier(
      job.payload.fileId ?? job.payload.file_id,
      "file_id",
    ),
  };
}

export function parseMediaConvert(job: CustomWorkerJob): MediaConvertInput {
  const vocalId = identifier(job.payload.vocalId, "vocal_id");
  const vocalType = enumValue(job.payload.vocalType, "vocal_type", [
    "app",
    "user",
    "clone",
  ] as const);
  const mediaType = enumValue(job.payload.mediaType, "media_type", [
    "video",
    "audio",
    "text",
  ] as const);
  const creditCost = integer(
    job.payload.creditCost ?? 0,
    "credit_cost",
    0,
    1_000_000,
  );
  if (
    !job.payload.input ||
    typeof job.payload.input !== "object" ||
    Array.isArray(job.payload.input)
  ) {
    throw new VocoStarJobError("input_invalid");
  }
  const raw = job.payload.input as Record<string, unknown>;
  let input: Record<string, string>;
  let sourceFileId: string | null = null;
  if (mediaType === "video") {
    sourceFileId = fileIdentifier(
      raw.fileId ?? raw.file_id ?? raw.videoFileId ?? raw.video_file_id,
      "file_id",
    );
    input = {
      video_file_id: sourceFileId,
    };
  } else if (mediaType === "audio") {
    sourceFileId = fileIdentifier(
      raw.fileId ?? raw.file_id ?? raw.audioFileId ?? raw.audio_file_id,
      "file_id",
    );
    input = {
      audio_file_id: sourceFileId,
    };
  } else {
    const text = stringValue(raw.text ?? raw.text_src, "text_src", 10_000);
    const language = stringValue(
      raw.language ?? "en",
      "language",
      8,
    ).toLowerCase();
    input = { text_src: text, language };
  }
  return {
    vocalId,
    vocalType,
    mediaType,
    input,
    sourceFileId,
    creditCost,
  };
}

export function parseJobIdentifier(value: unknown): string {
  return identifier(value, "job_id");
}

export async function requestHash(job: CustomWorkerJob): Promise<string> {
  const canonical = JSON.stringify(
    sortValue({
      projectRef: job.projectRef,
      capability: job.capability,
      payload: job.payload,
    }),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fileIdentifier(value: unknown, field: string): string {
  const result = stringValue(value, field, 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      result,
    )
  ) {
    throw new VocoStarJobError(`${field}_invalid`);
  }
  return result.toLowerCase();
}

function identifier(value: unknown, field: string): string {
  const result = stringValue(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))
    throw new VocoStarJobError(`${field}_invalid`);
  return result;
}

function stringValue(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new VocoStarJobError(`${field}_invalid`);
  const result = value.trim();
  if (!result || result.length > maximum)
    throw new VocoStarJobError(`${field}_invalid`);
  return result;
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new VocoStarJobError(`${field}_invalid`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  field: string,
  values: T,
): T[number] {
  if (typeof value !== "string" || !values.includes(value))
    throw new VocoStarJobError(`${field}_invalid`);
  return value as T[number];
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}
