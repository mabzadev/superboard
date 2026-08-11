import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const apiUrl = () =>
  (process.env.NEXT_PUBLIC_API_URL ||
    process.env.PLAYWRIGHT_API_URL ||
    "http://127.0.0.1:8787").replace(/\/$/, "");

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

test.describe.serial("real SuperBoard production flows", () => {
  test("auth, configuration, links, SDK, billing and cleanup run against the Worker", async ({
    page,
    request,
  }) => {
    const baseUrl = apiUrl();
    const suffix = unique();
    const email = `real-${suffix}@opengrow.local`;
    const password = "SuperBoardE2E123!";
    const bundleId = `io.opengrow.real.${suffix.replace(/[^a-z0-9]/g, "")}`;
    const packageName = `io.opengrow.real.${suffix.replace(/[^a-z0-9]/g, "")}`;
    const linkPath = `real-${suffix}`.slice(0, 48);

    const signup = await request.post(`${baseUrl}/api/v1/auth/sign_up`, {
      data: { email, password, name: "SuperBoard Real E2E" },
    });
    expect(signup.ok()).toBeTruthy();
    const auth = await signup.json();
    const token = auth.access_token || auth.token;
    const instance = auth.instance;
    expect(token).toBeTruthy();
    expect(instance?.id).toBeTruthy();

    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.evaluate(
      ({ accessToken, refreshToken, user, currentInstance }) => {
        localStorage.setItem("access_token", accessToken);
        localStorage.setItem("refresh_token", refreshToken);
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: user.id,
            email: user.email,
            name: user.name,
            roles: [{ instance_id: String(currentInstance.id), role: "owner" }],
            otp_required_for_login: false,
          })
        );
      },
      {
        accessToken: token,
        refreshToken: auth.refresh_token || "",
        user: auth.user,
        currentInstance: instance,
      }
    );
    await page.goto("/dashboard");
    await expect(page.getByText(/active users|top performing/i).first()).toBeVisible();

    const authHeaders = { Authorization: `Bearer ${token}` };
    const ios = await request.put(`${baseUrl}/api/v1/instances/${instance.id}/configurations/ios`, {
      headers: authHeaders,
      data: { bundle_id: bundleId, app_prefix: "ABCDE12345" },
    });
    expect(ios.ok()).toBeTruthy();

    const android = await request.put(`${baseUrl}/api/v1/instances/${instance.id}/configurations/android`, {
      headers: authHeaders,
      data: {
        package_name: packageName,
        sha256_cert_fingerprints: ["AA:BB:CC:DD:EE:FF"],
      },
    });
    expect(android.ok()).toBeTruthy();

    const web = await request.put(`${baseUrl}/api/v1/instances/${instance.id}/configurations/web`, {
      headers: authHeaders,
      data: { domains: ["localhost:3001"] },
    });
    expect(web.ok()).toBeTruthy();

    const projectExternalId = `${instance.id}-prod`;
    const createdLink = await request.post(`${baseUrl}/api/v1/projects/${projectExternalId}/links`, {
      headers: authHeaders,
      data: {
        path: linkPath,
        name: "Real E2E Link",
        title: "Real E2E Link",
        data: { appLink: `${instance.uri_scheme}://${linkPath}` },
        ios_url: "https://example.com/ios",
        android_url: "https://example.com/android",
        desktop_url: "https://example.com/desktop",
      },
    });
    expect(createdLink.ok()).toBeTruthy();
    const createdLinkBody = await createdLink.json();
    expect(createdLinkBody.link.path).toBe(linkPath);

    const opened = await request.get(`${baseUrl}/${linkPath}?go_to_fallback=true`, {
      maxRedirects: 0,
    });
    expect([200, 302, 303]).toContain(opened.status());

    const normalizedScheme = String(instance.uri_scheme).toLowerCase().replace(/[^a-z0-9]/g, "_");
    const projectKey = `${normalizedScheme}_prod_${instance.id}`;
    const sdkAuth = await request.post(`${baseUrl}/api/v1/sdk/authenticate`, {
      headers: {
        "PROJECT-KEY": projectKey,
        PLATFORM: "ios",
        IDENTIFIER: bundleId,
      },
      data: {
        app_version: "1.0.0",
        user_agent: "SuperBoardRealE2E/1.0",
        vendor_id: `vendor-${suffix}`,
      },
    });
    expect(sdkAuth.ok()).toBeTruthy();
    const sdk = await sdkAuth.json();
    expect(sdk.linksquared).toBeTruthy();

    const sdkEvent = await request.post(`${baseUrl}/api/v1/sdk/event`, {
      headers: {
        "PROJECT-KEY": projectKey,
        PLATFORM: "ios",
        IDENTIFIER: bundleId,
        LINKSQUARED: sdk.linksquared,
      },
      data: { event: "app_open", path: linkPath },
    });
    expect(sdkEvent.ok()).toBeTruthy();

    const sdkRegister = await request.post(`${baseUrl}/api/v1/sdk/register`, {
      headers: {
        "PROJECT-KEY": projectKey,
        PLATFORM: "ios",
        IDENTIFIER: bundleId,
        "User-Agent": "SuperBoardRealE2E/1.0",
      },
      data: {
        platform: "ios",
        app_version: "1.0.0",
        vendor: `notification-vendor-${suffix}`,
      },
    });
    expect(sdkRegister.ok()).toBeTruthy();
    const registeredDevice = await sdkRegister.json();
    expect(registeredDevice.device_id).toBeTruthy();

    const notificationTitle = `Real E2E Notification ${suffix}`;
    const notification = await request.post(`${baseUrl}/api/v1/projects/${projectExternalId}/notifications`, {
      headers: authHeaders,
      data: {
        title: notificationTitle,
        subtitle: "Real messaging path",
        html: "<p>Real message</p>",
        platforms: ["ios"],
        existing_users: true,
        new_users: false,
        auto_display: true,
        send_push: false,
      },
    });
    expect(notification.ok()).toBeTruthy();

    const sdkNotifications = await request.get(
      `${baseUrl}/api/v1/sdk/notifications?device_id=${registeredDevice.device_id}`,
      {
        headers: {
          "PROJECT-KEY": projectKey,
          PLATFORM: "ios",
          IDENTIFIER: bundleId,
        },
      }
    );
    expect(sdkNotifications.ok()).toBeTruthy();
    const sdkNotificationsBody = await sdkNotifications.json();
    expect(
      sdkNotificationsBody.notifications.some(
        (item: { title?: string }) => item.title === notificationTitle
      )
    ).toBeTruthy();

    await page.goto("/messaging");
    await expect(page.getByText(notificationTitle).first()).toBeVisible();

    await expect(page.goto("/settings")).resolves.toBeTruthy();
    await expect(page.getByText(/project settings/i).first()).toBeVisible();

    const redirectUri = "http://localhost:3001/mcp-callback";
    const mcpClient = await request.post(`${baseUrl}/register`, {
      data: {
        client_name: `Real MCP ${suffix}`,
        redirect_uris: [redirectUri],
      },
    });
    expect(mcpClient.ok()).toBeTruthy();
    const mcpClientBody = await mcpClient.json();
    const verifier = `verifier-${suffix}`;
    const state = `state-${suffix}`;
    await page.goto(
      `/mcp/authorize?client_id=${encodeURIComponent(mcpClientBody.client_id)}` +
        `&client_name=${encodeURIComponent(mcpClientBody.client_name)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        "&response_type=code" +
        `&code_challenge=${encodeURIComponent(pkceChallenge(verifier))}` +
        "&code_challenge_method=S256" +
        `&state=${encodeURIComponent(state)}` +
        "&scope=mcp%3Afull"
    );
    await expect(page.getByText("Authorize Connection")).toBeVisible();
    await page.getByRole("button", { name: "Authorize" }).click();
    await expect(page).toHaveURL(/\/mcp-callback\?code=mcp_code_.*state=state-/);

    const removed = await request.delete(`${baseUrl}/api/v1/instances/${instance.id}`, {
      headers: authHeaders,
    });
    expect(removed.ok()).toBeTruthy();
  });
});
