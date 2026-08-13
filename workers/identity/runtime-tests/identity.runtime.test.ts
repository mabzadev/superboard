import { env, SELF } from "cloudflare:test";
import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { decodeJwt } from "jose";
import { inflateSync } from "fflate";
import { SignedXml } from "xml-crypto";
import { describe, expect, it } from "vitest";

describe("Identity Worker with D1", () => {
  it("reports the applied D1 schema revision", async () => {
    const response = await SELF.fetch("https://identity.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "identity",
      status: "ok",
      schema: {
        status: "current",
        expectedMigration: "0148_superboard_identity_resource_scope.sql",
        latestMigration: "0148_superboard_identity_resource_scope.sql",
        appliedMigrationCount: 50,
      },
      project_scope: { ready: true, unscoped_rows: 0 },
    });
  });

  it("rotates anonymous sessions and issues a distinct OpenGrow identity token", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.20",
        }),
        body: JSON.stringify({ installation_id: "reference-installation-1" }),
      }),
    );
    expect(created.access_token).toBeTruthy();
    expect(decodeJwt(created.access_token).pid).toBe(101);
    expect(created.refresh_token).toMatch(/^ogr_/);
    expect(created.user.anonymous).toBe(true);

    const missingLinkAuth = await SELF.fetch(
      "https://identity.test/auth/link/google",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-accepted-without-authentication" }),
      },
    );
    expect(missingLinkAuth.status).toBe(401);
    const unsupportedLink = await SELF.fetch(
      "https://identity.test/auth/link/microsoft",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: "unsupported-provider-token" }),
      },
    );
    expect(unsupportedLink.status).toBe(404);

    const exchanged = await json<{ access_token: string; expires_in: number }>(
      await SELF.fetch("https://identity.test/auth/opengrow-token", {
        method: "POST",
        headers: { authorization: `Bearer ${created.access_token}` },
      }),
    );
    expect(exchanged.expires_in).toBe(300);
    expect(exchanged.access_token).not.toBe(created.access_token);

    const refreshed = await json<Session>(
      await SELF.fetch("https://identity.test/auth/refresh", {
        method: "POST",
        headers: await projectHeaders(
          "POST",
          "/auth/refresh",
          {
            "content-type": "application/json",
            "cf-connecting-ip": "192.0.2.20",
          },
          secondProject,
        ),
        body: JSON.stringify({ refresh_token: created.refresh_token }),
      }),
    );
    expect(refreshed.refresh_token).not.toBe(created.refresh_token);
    expect(decodeJwt(refreshed.access_token).pid).toBe(101);

    const replay = await SELF.fetch("https://identity.test/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "192.0.2.20",
      },
      body: JSON.stringify({ refresh_token: created.refresh_token }),
    });
    expect(replay.status).toBe(401);

    const logout = await SELF.fetch("https://identity.test/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${refreshed.access_token}` },
    });
    expect(logout.status).toBe(200);
    const afterLogout = await SELF.fetch(
      "https://identity.test/auth/opengrow-token",
      {
        method: "POST",
        headers: { authorization: `Bearer ${refreshed.access_token}` },
      },
    );
    expect(afterLogout.status).toBe(401);
  });

  it("does not reveal whether a password-reset email exists", async () => {
    const response = await SELF.fetch(
      "https://identity.test/auth/request-password-reset",
      {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/request-password-reset", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.21",
        }),
        body: JSON.stringify({ email: "missing@example.test" }),
      },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });

  it("erases identity only through the authenticated internal contract", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.22",
        }),
        body: JSON.stringify({ installation_id: "identity-erasure-runtime" }),
      }),
    );
    const unauthorized = await SELF.fetch(
      `https://identity.test/internal/v1/users/${created.user.id}`,
      { method: "DELETE" },
    );
    expect(unauthorized.status).toBe(401);
    const incompletePublicDeletion = await SELF.fetch(
      "https://identity.test/auth/me",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${created.access_token}` },
      },
    );
    expect(incompletePublicDeletion.status).toBe(410);
    await expect(incompletePublicDeletion.json()).resolves.toMatchObject({
      error: { code: "account_erasure_route_required", retryable: false },
    });

    const eraseRequest = async () =>
      SELF.fetch(`https://identity.test/internal/v1/users/${created.user.id}`, {
        method: "DELETE",
        headers: await projectHeaders(
          "DELETE",
          `/internal/v1/users/${created.user.id}`,
        ),
      });
    const erased = await eraseRequest();
    expect(erased.status, await erased.clone().text()).toBe(200);
    await expect(erased.json()).resolves.toEqual({ deleted: true });
    const repeated = await eraseRequest();
    await expect(repeated.json()).resolves.toEqual({ deleted: true });

    const afterErasure = await SELF.fetch(
      "https://identity.test/auth/opengrow-token",
      {
        method: "POST",
        headers: { authorization: `Bearer ${created.access_token}` },
      },
    );
    expect(afterErasure.status).toBe(401);
    const database = env as unknown as { DB: D1Database };
    const [user, sessions, identities, tokens] = await database.DB.batch([
      database.DB.prepare(
        "SELECT email, name, password_hash, deleted_at FROM application_users WHERE id = ?",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_sessions WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_identities WHERE user_id = ?",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_identity_tokens WHERE user_id = ?",
      ).bind(created.user.id),
    ]);
    expect(user.results[0]).toMatchObject({
      email: null,
      name: null,
      password_hash: null,
      deleted_at: expect.any(String),
    });
    expect(sessions.results[0]).toMatchObject({ total: 0 });
    expect(identities.results[0]).toMatchObject({ total: 0 });
    expect(tokens.results[0]).toMatchObject({ total: 0 });
  });

  it("exposes sanitized authentication state only through the internal admin contract", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.23",
        }),
        body: JSON.stringify({ installation_id: "identity-admin-runtime" }),
      }),
    );
    const database = env as unknown as { DB: D1Database };
    await database.DB.batch([
      database.DB.prepare(
        `UPDATE application_users
         SET email=?, name=?, password_hash=?, is_anonymous=0,
             email_verified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE project_id=? AND id=?`,
      ).bind(
        "identity-admin@example.test",
        "Identity Admin Fixture",
        "password-hash-must-never-leave-identity",
        101,
        created.user.id,
      ),
      database.DB.prepare(
        `INSERT INTO application_identities
           (id,project_id,user_id,provider,subject_hash,provider_email)
         VALUES (?,?,?,"google",?,?)`,
      ).bind(
        crypto.randomUUID(),
        101,
        created.user.id,
        "provider-subject-hash-must-never-leave-identity",
        "identity-admin@example.test",
      ),
    ]);

    const unauthorized = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users",
    );
    expect(unauthorized.status).toBe(401);

    const listedResponse = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users?q=google&limit=10&offset=0",
      {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      },
    );
    expect(listedResponse.status, await listedResponse.clone().text()).toBe(
      200,
    );
    const listed = await listedResponse.json<{
      data: Array<Record<string, unknown>>;
      meta: { total: number; limit: number; offset: number; has_more: boolean };
    }>();
    expect(listed.data).toContainEqual(
      expect.objectContaining({
        id: created.user.id,
        email: "identity-admin@example.test",
        anonymous: false,
        email_verified: true,
        password_configured: true,
        providers: ["anonymous", "google"],
        auth_methods: ["password", "anonymous", "google"],
        active_session_count: 1,
      }),
    );
    expect(listed.meta).toMatchObject({ limit: 10, offset: 0 });

    const detailResponse = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${created.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${created.user.id}`,
        ),
      },
    );
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(
      200,
    );
    const detailText = await detailResponse.text();
    expect(detailText).not.toContain("password-hash-must-never-leave-identity");
    expect(detailText).not.toContain(
      "provider-subject-hash-must-never-leave-identity",
    );
    expect(detailText).not.toContain(created.refresh_token);
    expect(JSON.parse(detailText)).toMatchObject({
      data: {
        id: created.user.id,
        identities: [
          { provider: "anonymous" },
          {
            provider: "google",
            provider_email: "identity-admin@example.test",
          },
        ],
        sessions: { total: 1, active: 1, revoked: 0, expired: 0 },
      },
    });

    const invalidPagination = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users?limit=101",
      {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      },
    );
    expect(invalidPagination.status).toBe(422);
  });

  it("isolates users, providers, sessions and details between projects", async () => {
    const projectOne = await anonymous(
      "shared-installation-identity-isolation",
      "192.0.2.31",
    );
    const projectTwo = await anonymous(
      "shared-installation-identity-isolation",
      "192.0.2.32",
      secondProject,
    );
    expect(projectOne.user.id).not.toBe(projectTwo.user.id);
    expect(decodeJwt(projectOne.access_token).pid).toBe(101);
    expect(decodeJwt(projectTwo.access_token).pid).toBe(202);

    const projectOneList = await json<{ data: Array<{ id: string }> }>(
      await SELF.fetch("https://identity.test/internal/v1/admin/users", {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      }),
    );
    expect(projectOneList.data.map(({ id }) => id)).toContain(
      projectOne.user.id,
    );
    expect(projectOneList.data.map(({ id }) => id)).not.toContain(
      projectTwo.user.id,
    );

    const crossProjectDetail = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${projectTwo.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${projectTwo.user.id}`,
        ),
      },
    );
    expect(crossProjectDetail.status).toBe(404);

    const projectTwoDetail = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${projectTwo.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${projectTwo.user.id}`,
          undefined,
          secondProject,
        ),
      },
    );
    expect(projectTwoDetail.status).toBe(200);
  });

  it("serves the native Melody OIDC engine only through the auth gateway", async () => {
    const legacyJwks = await json<{ keys: Array<{ alg: string }> }>(
      await SELF.fetch("https://identity.test/.well-known/jwks.json"),
    );
    expect(legacyJwks.keys[0]?.alg).toBe("ES256");

    const gatewayHeaders = { "x-superboard-auth-gateway": "1" };
    const discovery = await json<Record<string, unknown>>(
      await SELF.fetch(
        "https://identity.test/.well-known/openid-configuration",
        { headers: gatewayHeaders },
      ),
    );
    expect(discovery).toMatchObject({
      issuer: "https://auth.example.test",
      authorization_endpoint:
        "https://auth.example.test/oauth2/v1/authorize",
      token_endpoint: "https://auth.example.test/oauth2/v1/token",
      jwks_uri: "https://auth.example.test/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["RS256"],
    });

    const melodyJwks = await json<{
      keys: Array<{ alg: string; kty: string; kid: string }>;
    }>(
      await SELF.fetch("https://identity.test/.well-known/jwks.json", {
        headers: gatewayHeaders,
      }),
    );
    expect(melodyJwks.keys).toHaveLength(1);
    expect(melodyJwks.keys[0]).toMatchObject({ alg: "RS256", kty: "RSA" });
    expect(melodyJwks.keys[0]?.kid).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("renders Melody's hosted authorization UI and bundled assets", async () => {
    const database = env as unknown as { DB: D1Database };
    const client = await database.DB.prepare(
      "SELECT clientId FROM app WHERE id=1",
    ).first<{ clientId: string }>();
    expect(client?.clientId).toBeTruthy();
    const authorize = new URL("https://identity.test/oauth2/v1/authorize");
    authorize.searchParams.set("client_id", client?.clientId ?? "");
    authorize.searchParams.set(
      "redirect_uri",
      "http://localhost:3000/en/dashboard",
    );
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", "runtime-state");
    authorize.searchParams.set(
      "code_challenge",
      "runtime-code-challenge-that-is-long-enough-for-pkce",
    );
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("scope", "openid profile offline_access");
    authorize.searchParams.set("locale", "en");

    const response = await SELF.fetch(authorize, {
      redirect: "manual",
      headers: { "x-superboard-auth-gateway": "1" },
    });
    expect(response.status, await response.clone().text()).toBe(302);
    expect(response.headers.get("location")).toContain(
      "/identity/v1/view/authorize?",
    );

    const viewUrl = new URL(response.headers.get("location") ?? "", authorize);
    const view = await SELF.fetch(viewUrl, {
      headers: { "x-superboard-auth-gateway": "1" },
    });
    expect(view.status, await view.clone().text()).toBe(200);
    const html = await view.text();
    expect(html).toContain("/client.css");
    expect(html).toContain("/client.js");
    expect(html).toContain("window.__initialProps");

    const asset = await SELF.fetch("https://identity.test/client.js", {
      headers: { "x-superboard-auth-gateway": "1" },
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("max-age=300");
  });

  it("runs the native Cloudflare SAML SP flow with signed assertions and replay protection", async () => {
    const runtime = env as unknown as {
      DB: D1Database;
      MELODY_AUTH_SECRETS: string;
    };
    const encodedSecrets = JSON.parse(runtime.MELODY_AUTH_SECRETS) as {
      sp: string;
      sc: string;
    };
    const secrets = {
      samlPrivateKeyPem: testPem(encodedSecrets.sp, "PRIVATE KEY"),
      samlCertificatePem: testPem(encodedSecrets.sc, "CERTIFICATE"),
    };
    const idpEntityId = "https://idp.example.test/metadata";
    const idpSsoUrl = "https://idp.example.test/sso";
    const certificate = secrets.samlCertificatePem
      .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, "");
    const metadata = [
      '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
      ` entityID="${idpEntityId}"><md:IDPSSODescriptor`,
      ' protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
      '<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
      `<ds:X509Data><ds:X509Certificate>${certificate}</ds:X509Certificate></ds:X509Data>`,
      '</ds:KeyInfo></md:KeyDescriptor>',
      `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${idpSsoUrl}"/>`,
      '</md:IDPSSODescriptor></md:EntityDescriptor>',
    ].join("");
    await runtime.DB.prepare(
      `INSERT INTO saml_idp
         (name,"userIdAttribute","emailAttribute","firstNameAttribute","lastNameAttribute",metadata,"isActive")
       VALUES (?,?,?,?,?,?,1)`,
    ).bind(
      "runtime",
      "uid",
      "email",
      "first_name",
      "last_name",
      metadata,
    ).run();

    const spMetadata = await SELF.fetch(
      "https://identity.test/saml/sp/v1/metadata",
      { headers: { "x-superboard-auth-gateway": "1" } },
    );
    expect(spMetadata.status, await spMetadata.clone().text()).toBe(200);
    expect(spMetadata.headers.get("content-type")).toContain("application/xml");
    expect(await spMetadata.text()).toContain(
      "https://auth.example.test/saml/sp/v1/acs",
    );

    const client = await runtime.DB.prepare(
      "SELECT clientId FROM app WHERE id=1",
    ).first<{ clientId: string }>();
    const authorize = new URL("https://identity.test/oauth2/v1/authorize");
    authorize.searchParams.set("client_id", client?.clientId ?? "");
    authorize.searchParams.set("redirect_uri", "http://localhost:3000/en/dashboard");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", "saml-runtime-state");
    authorize.searchParams.set("code_challenge", "saml-runtime-code-challenge-that-is-long-enough");
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("scope", "openid profile offline_access");
    authorize.searchParams.set("locale", "en");
    authorize.searchParams.set("policy", "saml_sso_runtime");
    const begin = await SELF.fetch(authorize, {
      redirect: "manual",
      headers: { "x-superboard-auth-gateway": "1" },
    });
    expect(begin.status).toBe(302);
    const login = await SELF.fetch(
      new URL(begin.headers.get("location") ?? "", authorize),
      {
        redirect: "manual",
        headers: { "x-superboard-auth-gateway": "1" },
      },
    );
    expect(login.status, await login.clone().text()).toBe(302);
    const idpRedirect = new URL(login.headers.get("location") ?? "");
    expect(idpRedirect.origin).toBe("https://idp.example.test");
    const relayState = idpRedirect.searchParams.get("RelayState") ?? "";
    const samlRequest = idpRedirect.searchParams.get("SAMLRequest") ?? "";
    const requestXml = new TextDecoder().decode(inflateSync(base64Bytes(samlRequest)));
    const requestId = /\bID="([^"]+)"/u.exec(requestXml)?.[1] ?? "";
    expect(requestId).toMatch(/^_[0-9a-f-]{36}$/u);

    const now = Date.now();
    const assertionId = `_${crypto.randomUUID()}`;
    const assertion = [
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ` ID="_${crypto.randomUUID()}" Version="2.0" IssueInstant="${new Date(now).toISOString()}"`,
      ` InResponseTo="${requestId}" Destination="https://auth.example.test/saml/sp/v1/acs">`,
      `<saml:Issuer>${idpEntityId}</saml:Issuer>`,
      '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
      `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${new Date(now).toISOString()}">`,
      `<saml:Issuer>${idpEntityId}</saml:Issuer>`,
      '<saml:Subject><saml:NameID>runtime-user</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">',
      `<saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="https://auth.example.test/saml/sp/v1/acs" NotOnOrAfter="${new Date(now + 300_000).toISOString()}"/>`,
      '</saml:SubjectConfirmation></saml:Subject>',
      `<saml:Conditions NotBefore="${new Date(now - 5_000).toISOString()}" NotOnOrAfter="${new Date(now + 300_000).toISOString()}">`,
      '<saml:AudienceRestriction><saml:Audience>https://auth.example.test/saml/sp/v1/metadata</saml:Audience></saml:AudienceRestriction>',
      '</saml:Conditions>',
      '<saml:AuthnStatement AuthnInstant="' + new Date(now).toISOString() + '"><saml:AuthnContext><saml:AuthnContextClassRef>',
      'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
      '</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>',
      '<saml:AttributeStatement>',
      '<saml:Attribute Name="uid"><saml:AttributeValue>runtime-user</saml:AttributeValue></saml:Attribute>',
      '<saml:Attribute Name="email"><saml:AttributeValue>saml-runtime@example.test</saml:AttributeValue></saml:Attribute>',
      '<saml:Attribute Name="first_name"><saml:AttributeValue>SAML</saml:AttributeValue></saml:Attribute>',
      '<saml:Attribute Name="last_name"><saml:AttributeValue>Runtime</saml:AttributeValue></saml:Attribute>',
      '</saml:AttributeStatement></saml:Assertion></samlp:Response>',
    ].join("");
    const signer = new SignedXml({
      privateKey: secrets.samlPrivateKeyPem,
      publicCert: secrets.samlCertificatePem,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    signer.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    signer.computeSignature(assertion, {
      location: {
        reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
        action: "after",
      },
    });
    const form = new URLSearchParams({
      RelayState: relayState,
      SAMLResponse: btoa(signer.getSignedXml()),
    });
    const postAssertion = () => SELF.fetch(
      "https://identity.test/saml/sp/v1/acs",
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-superboard-auth-gateway": "1",
        },
        body: form,
      },
    );
    const accepted = await postAssertion();
    expect(accepted.status, await accepted.clone().text()).toBe(302);
    expect(accepted.headers.get("location")).toContain("code=");
    const replay = await postAssertion();
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("already been used");
  });

  it("isolates Melody applications behind the signed SuperBoard project realm", async () => {
    const projectOneApp = await melodyAdminJson<{
      app: { id: number; name: string; clientId: string };
    }>(
      "POST",
      "/api/v1/apps",
      {
        name: "Project one web app",
        type: "spa",
        scopes: ["openid", "profile", "offline_access"],
        redirectUris: ["https://one.example.test/callback"],
      },
    );
    const projectTwoApp = await melodyAdminJson<{
      app: { id: number; name: string; clientId: string };
    }>(
      "POST",
      "/api/v1/apps",
      {
        name: "Project two web app",
        type: "spa",
        scopes: ["openid", "profile"],
        redirectUris: ["https://two.example.test/callback"],
      },
      secondProject,
    );
    expect(projectOneApp.app.id).not.toBe(projectTwoApp.app.id);

    const projectOneList = await melodyAdminJson<{
      apps: Array<{ id: number; name: string }>;
    }>("GET", "/api/v1/apps");
    expect(projectOneList.apps.map(({ id }) => id)).toContain(
      projectOneApp.app.id,
    );
    expect(projectOneList.apps.map(({ id }) => id)).not.toContain(
      projectTwoApp.app.id,
    );

    const crossProject = await melodyAdmin(
      "GET",
      `/api/v1/apps/${projectTwoApp.app.id}`,
    );
    expect(crossProject.status).toBe(404);
    const database = env as unknown as { DB: D1Database };
    const mappings = await database.DB.prepare(
      `SELECT project_id,melody_app_id FROM identity_app_realm
       WHERE realm=? ORDER BY project_id`,
    ).bind("test:local").all();
    expect(mappings.results).toEqual([
      { project_id: 101, melody_app_id: projectOneApp.app.id },
      { project_id: 202, melody_app_id: projectTwoApp.app.id },
    ]);
  });

  it("isolates roles and other Melody administration resources between projects", async () => {
    const projectOneRole = await melodyAdminJson<{
      role: { id: number; name: string };
    }>("POST", "/api/v1/roles", {
      name: "runtime_project_one_editor",
      note: "Project one only",
    });
    const projectTwoRole = await melodyAdminJson<{
      role: { id: number; name: string };
    }>(
      "POST",
      "/api/v1/roles",
      {
        name: "runtime_project_two_editor",
        note: "Project two only",
      },
      secondProject,
    );
    const projectOne = await melodyAdminJson<{
      roles: Array<{ id: number; name: string }>;
    }>("GET", "/api/v1/roles");
    expect(projectOne.roles.map(({ id }) => id)).toContain(projectOneRole.role.id);
    expect(projectOne.roles.map(({ id }) => id)).not.toContain(projectTwoRole.role.id);
    expect(projectOne.roles.map(({ name }) => name)).toContain("super_admin");

    const crossProject = await melodyAdmin(
      "GET",
      `/api/v1/roles/${projectTwoRole.role.id}`,
    );
    expect(crossProject.status).toBe(404);
    const ownProject = await melodyAdmin(
      "GET",
      `/api/v1/roles/${projectTwoRole.role.id}`,
      undefined,
      secondProject,
    );
    expect(ownProject.status).toBe(200);
  });

  it("reuses the canonical application user id instead of duplicating an invited user", async () => {
    const database = env as unknown as { DB: D1Database };
    const canonicalId = "44444444-4444-4444-8444-444444444444";
    await database.DB.prepare(
      `INSERT INTO application_users
         (id,project_id,email,name,is_anonymous,email_verified_at)
       VALUES (?,?,?, ?,0,CURRENT_TIMESTAMP)`,
    ).bind(
      canonicalId,
      101,
      "canonical@example.test",
      "Existing SuperBoard user",
    ).run();

    const invitation = await melodyAdminJson<{
      user: { authId: string; email: string };
    }>(
      "POST",
      "/api/v1/users/invitations",
      {
        email: "canonical@example.test",
        firstName: "Canonical",
        lastName: "Person",
        locale: "en",
        roles: [],
      },
    );
    expect(invitation.user).toMatchObject({
      authId: canonicalId,
      email: "canonical@example.test",
    });

    const list = await melodyAdminJson<{
      users: Array<{ authId: string; email: string }>;
      count: number;
    }>("GET", "/api/v1/users?search=canonical@example.test");
    expect(list.users).toContainEqual(
      expect.objectContaining({
        authId: canonicalId,
        email: "canonical@example.test",
      }),
    );
    const detail = await melodyAdminJson<{
      user: { authId: string; email: string };
    }>("GET", `/api/v1/users/${canonicalId}`);
    expect(detail.user.authId).toBe(canonicalId);

    const [legacyRows, bridge] = await database.DB.batch([
      database.DB.prepare(
        `SELECT COUNT(*) count FROM application_users
         WHERE project_id=? AND email=?`,
      ).bind(101, "canonical@example.test"),
      database.DB.prepare(
        `SELECT application_user_id,project_id FROM identity_subject_bridge
         WHERE realm=? AND project_id=?`,
      ).bind("test:local", 101),
    ]);
    expect(legacyRows.results[0]).toEqual({ count: 1 });
    expect(bridge.results).toContainEqual({
      application_user_id: canonicalId,
      project_id: 101,
    });
  });

  it("refuses the Melody administration bypass for a signed non-admin context", async () => {
    const path = "/internal/v1/melody-admin/api/v1/apps";
    const response = await SELF.fetch(`https://identity.test${path}`, {
      headers: await projectHeaders("GET", path),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "administrator_required" },
    });
  });

  it("fails closed while a migrated legacy identity remains unscoped", async () => {
    const database = env as unknown as { DB: D1Database };
    await database.DB.prepare(
      "DROP TRIGGER application_users_project_required_insert",
    ).run();
    await database.DB.prepare(
      "INSERT INTO application_users (id,is_anonymous) VALUES (?,1)",
    )
      .bind("legacy-unscoped-runtime-user")
      .run();
    try {
      const admin = await SELF.fetch(
        "https://identity.test/internal/v1/admin/users",
        {
          headers: await projectHeaders("GET", "/internal/v1/admin/users"),
        },
      );
      expect(admin.status).toBe(503);
      await expect(admin.json()).resolves.toMatchObject({
        error: {
          code: "identity_project_backfill_required",
          retryable: true,
        },
      });

      const health = await SELF.fetch("https://identity.test/health");
      expect(health.status).toBe(503);
      await expect(health.json()).resolves.toMatchObject({
        status: "degraded",
        reason: "identity_project_backfill_required",
        project_scope: { ready: false, unscoped_rows: 1 },
      });
    } finally {
      await database.DB.prepare(
        "DELETE FROM application_users WHERE id=? AND project_id IS NULL",
      )
        .bind("legacy-unscoped-runtime-user")
        .run();
      await database.DB.prepare(
        `CREATE TRIGGER application_users_project_required_insert
         BEFORE INSERT ON application_users
         WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
         BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END`,
      ).run();
    }
  });
});

type Session = {
  access_token: string;
  refresh_token: string;
  user: { id: string; anonymous: boolean };
};

async function json<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return response.json<T>();
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function testPem(value: string, label: string): string {
  const lines = value.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

const secondProject = {
  projectId: 202,
  instanceId: 20,
  projectRef: "20-test",
} as const;

type TestProject = {
  projectId: number;
  instanceId: number;
  projectRef: string;
};

async function anonymous(
  installationId: string,
  ip: string,
  project: TestProject = {
    projectId: 101,
    instanceId: 10,
    projectRef: "10-test",
  },
): Promise<Session> {
  return json<Session>(
    await SELF.fetch("https://identity.test/auth/anonymous", {
      method: "POST",
      headers: await projectHeaders(
        "POST",
        "/auth/anonymous",
        { "content-type": "application/json", "cf-connecting-ip": ip },
        project,
      ),
      body: JSON.stringify({ installation_id: installationId }),
    }),
  );
}

async function projectHeaders(
  method: string,
  pathname: string,
  initial?: HeadersInit,
  project: TestProject = {
    projectId: 101,
    instanceId: 10,
    projectRef: "10-test",
  },
  role = "sdk",
): Promise<Headers> {
  const requestId = crypto.randomUUID();
  const context: InternalProjectContext = {
    module: "identity",
    method,
    pathname,
    ...project,
    environment: "test",
    actorId: 0,
    role,
    requestId,
    issuedAt: Math.floor(Date.now() / 1_000),
  };
  const headers = new Headers(initial);
  headers.set(PROJECT_CONTEXT_HEADERS.token, "identity-runtime-internal-token");
  headers.set(PROJECT_CONTEXT_HEADERS.projectId, String(context.projectId));
  headers.set(PROJECT_CONTEXT_HEADERS.projectRef, context.projectRef);
  headers.set(PROJECT_CONTEXT_HEADERS.instanceId, String(context.instanceId));
  headers.set(PROJECT_CONTEXT_HEADERS.environment, context.environment);
  headers.set(PROJECT_CONTEXT_HEADERS.actorId, "0");
  headers.set(PROJECT_CONTEXT_HEADERS.role, context.role);
  headers.set(PROJECT_CONTEXT_HEADERS.requestId, requestId);
  headers.set(PROJECT_CONTEXT_HEADERS.issuedAt, String(context.issuedAt));
  headers.set(PROJECT_CONTEXT_HEADERS.version, "1");
  headers.set(
    PROJECT_CONTEXT_HEADERS.signature,
    await signProjectContext(context, "identity-runtime-internal-token"),
  );
  return headers;
}

async function melodyAdmin(
  method: string,
  suffix: string,
  body?: Record<string, unknown>,
  project: TestProject = {
    projectId: 101,
    instanceId: 10,
    projectRef: "10-test",
  },
): Promise<Response> {
  const target = new URL(
    `/internal/v1/melody-admin${suffix}`,
    "https://identity.test",
  );
  return SELF.fetch(target, {
    method,
    headers: await projectHeaders(
      method,
      target.pathname,
      body ? { "content-type": "application/json" } : undefined,
      project,
      "admin",
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function melodyAdminJson<T>(
  method: string,
  suffix: string,
  body?: Record<string, unknown>,
  project?: TestProject,
): Promise<T> {
  return json<T>(await melodyAdmin(method, suffix, body, project));
}
