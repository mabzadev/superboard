import { GET } from "@/lib/api";
import { config } from "@/lib/config";

export type ApplicationUser = {
  id: string;
  email: string | null;
  name: string | null;
  anonymous: boolean;
  email_verified: boolean;
  password_configured: boolean;
  providers: string[];
  auth_methods: string[];
  active_session_count: number;
  last_session_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationUserDetail = ApplicationUser & {
  identities: Array<{
    provider: string;
    provider_email: string | null;
    linked_at: string;
  }>;
  sessions: {
    total: number;
    active: number;
    revoked: number;
    expired: number;
    last_authenticated_at: string | null;
  };
};

export type ApplicationUserPage = {
  data: ApplicationUser[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
};

const basePath = (projectRef: string) =>
  `${config.apiPath}/application-users/projects/${encodeURIComponent(projectRef)}/users`;

export async function getApplicationUsers(
  projectRef: string,
  input: { query?: string; limit?: number; offset?: number } = {}
): Promise<ApplicationUserPage> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 50),
    offset: String(input.offset ?? 0),
  });
  if (input.query?.trim()) query.set("q", input.query.trim());
  return (await GET(`${basePath(projectRef)}?${query}`)).data;
}

export async function getApplicationUser(
  projectRef: string,
  userId: string
): Promise<ApplicationUserDetail> {
  const response = await GET(
    `${basePath(projectRef)}/${encodeURIComponent(userId)}`
  );
  return response.data.data;
}
