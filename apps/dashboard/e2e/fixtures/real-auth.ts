import type { APIRequestContext, Page } from "@playwright/test";

export const isRealBackendE2E = process.env.PLAYWRIGHT_REAL_BACKEND === "1";

type AuthPayload = {
  access_token?: string;
  token?: string;
  refresh_token?: string;
  user?: { id: string | number; email: string; name?: string | null };
  instance?: { id: string | number };
};

function apiUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
}

async function json(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const text = await response.text();
  try {
    return JSON.parse(text) as AuthPayload & { error?: string };
  } catch {
    return { error: text };
  }
}

export async function createRealAuthState(page: Page, request: APIRequestContext) {
  const email = process.env.PLAYWRIGHT_E2E_EMAIL || `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@opengrow.local`;
  const password = process.env.PLAYWRIGHT_E2E_PASSWORD || "OpenGrowE2E123!";
  const name = process.env.PLAYWRIGHT_E2E_NAME || "OpenGrow E2E";
  const baseUrl = apiUrl();

  let response = await request.post(`${baseUrl}/api/v1/auth/sign_up`, {
    data: { email, password, name },
  });
  let payload = await json(response);

  if (!response.ok() && response.status() === 422) {
    response = await request.post(`${baseUrl}/api/v1/auth/sign_in`, {
      data: { email, password },
    });
    payload = await json(response);
  }

  if (!response.ok()) {
    throw new Error(`Real backend auth failed (${response.status()}): ${payload.error || JSON.stringify(payload)}`);
  }

  const accessToken = payload.access_token || payload.token;
  if (!accessToken || !payload.user) {
    throw new Error("Real backend auth did not return a user and access token");
  }

  await page.addInitScript(
    ({ token, refreshToken, user, instance }) => {
      localStorage.setItem("access_token", token);
      if (refreshToken) localStorage.setItem("refresh_token", refreshToken);
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          roles: [{ instance_id: String(instance?.id || ""), role: "owner" }],
          otp_required_for_login: false,
        })
      );
    },
    {
      token: accessToken,
      refreshToken: payload.refresh_token || "",
      user: payload.user,
      instance: payload.instance || null,
    }
  );
}
