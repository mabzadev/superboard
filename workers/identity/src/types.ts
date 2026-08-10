export type IdentityEnv = Cloudflare.Env;

export type IdentityUser = {
  id: string;
  email: string | null;
  password_hash: string | null;
  name: string | null;
  is_anonymous: number;
  email_verified_at: string | null;
  created_at: string;
};
