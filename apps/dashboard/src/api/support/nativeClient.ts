import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

export type SupportCursorQuery = {
  cursor?: string | null;
  limit?: number;
  q?: string;
};

export type SupportCursorPage<T> = {
  data: T[];
  pagination: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
};

export type SupportEntity = {
  id: string;
  project_id?: number;
  created_at?: string;
  updated_at?: string;
};

export const supportProjectPath = (projectRef: string, resource: string) =>
  `${config.apiPath}/support/projects/${encodeURIComponent(projectRef)}/${resource.replace(/^\/+/, "")}`;

export async function listSupportResource<T>(
  projectRef: string,
  resource: string,
  query: SupportCursorQuery = {}
): Promise<SupportCursorPage<T>> {
  const search = new URLSearchParams();
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.q?.trim()) search.set("q", query.q.trim());
  search.set("limit", String(Math.min(100, Math.max(1, query.limit ?? 50))));
  return (
    await GET(
      `${supportProjectPath(projectRef, resource)}?${search.toString()}`
    )
  ).data;
}

export async function getSupportResource<T>(
  projectRef: string,
  resource: string,
  id: string
): Promise<{ data: T }> {
  return (
    await GET(
      `${supportProjectPath(projectRef, resource)}/${encodeURIComponent(id)}`
    )
  ).data;
}

export async function createSupportResource<T, TInput>(
  projectRef: string,
  resource: string,
  input: TInput
): Promise<{ data: T }> {
  return (
    await POST(supportProjectPath(projectRef, resource), input, {
      retry: false,
    })
  ).data;
}

export async function updateSupportResource<T, TInput>(
  projectRef: string,
  resource: string,
  id: string,
  input: TInput
): Promise<{ data: T }> {
  return (
    await PATCH(
      `${supportProjectPath(projectRef, resource)}/${encodeURIComponent(id)}`,
      input,
      { retry: false }
    )
  ).data;
}

export async function deleteSupportResource(
  projectRef: string,
  resource: string,
  id: string
): Promise<{ data: { id: string; deleted: true } }> {
  return (
    await DELETE(
      `${supportProjectPath(projectRef, resource)}/${encodeURIComponent(id)}`,
      { retry: false }
    )
  ).data;
}

export async function postSupportAction<T>(
  projectRef: string,
  resource: string,
  input: unknown = {}
): Promise<{ data: T }> {
  return (
    await POST(supportProjectPath(projectRef, resource), input, {
      retry: false,
    })
  ).data;
}

export async function putSupportAction<T>(
  projectRef: string,
  resource: string,
  input: unknown
): Promise<{ data: T }> {
  return (
    await PUT(supportProjectPath(projectRef, resource), input, {
      retry: false,
    })
  ).data;
}

export async function deleteSupportAction<T>(
  projectRef: string,
  resource: string
): Promise<{ data: T }> {
  return (
    await DELETE(supportProjectPath(projectRef, resource), { retry: false })
  ).data;
}

export async function getSupportAction<T>(
  projectRef: string,
  resource: string,
  query?: Record<string, string | undefined>
): Promise<{ data: T }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) search.set(key, value);
  }
  const suffix = search.size ? `?${search.toString()}` : "";
  return (await GET(`${supportProjectPath(projectRef, resource)}${suffix}`))
    .data;
}
