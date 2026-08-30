"use client";

import type { PropsWithChildren } from "react";
import LocalStorage from "@/lib/LocalStorage";
import { configSignal, errorSignal } from "signals";

type RedirectOptions = {
  locale?: string;
  policy?: string;
  org?: string;
  postLogoutRedirectUri?: string;
};

export function AuthProvider({ children }: PropsWithChildren) {
  return children;
}

export function useAuth() {
  const accessToken =
    typeof window === "undefined"
      ? ""
      : (LocalStorage.getAuthenticationToken() ?? "");
  const operatorSession =
    typeof window !== "undefined" &&
    Boolean(
      (window as Window & { __SUPERBOARD_OPERATOR_AUTHENTICATED__?: boolean })
        .__SUPERBOARD_OPERATOR_AUTHENTICATED__
    );
  return {
    accessToken,
    isAuthenticated: Boolean(accessToken) || operatorSession,
    isAuthenticating: false,
    isLoadingUserInfo: false,
    acquireUserInfoError: "",
    userInfo: { roles: ["super_admin"], authId: null as string | null },
    acquireToken: async () => LocalStorage.getAuthenticationToken() ?? "",
    acquireUserInfo: async () => ({ roles: ["super_admin"] }),
    logoutRedirect: ({ postLogoutRedirectUri }: RedirectOptions = {}) => {
      if (postLogoutRedirectUri && typeof window !== "undefined") {
        window.location.assign(postLogoutRedirectUri);
      }
    },
    loginRedirect: (options: RedirectOptions = {}) => {
      if (typeof window === "undefined") return;
      void redirectToIdentityPolicy(options);
    },
  };
}

async function redirectToIdentityPolicy(
  options: RedirectOptions
): Promise<void> {
  try {
    const app = window.sessionStorage.getItem("superboard.identity.primaryApp");
    if (!app) {
      errorSignal.value =
        "Create an active SPA application before opening an account policy.";
      return;
    }
    const parsed = JSON.parse(app) as { clientId: string; redirectUri: string };
    if (!parsed.clientId || !parsed.redirectUri)
      throw new Error("invalid_identity_application");

    const verifier = randomBase64Url(64);
    const state = randomBase64Url(32);
    const challenge = base64Url(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    );
    window.sessionStorage.setItem(
      `superboard.identity.pkce.${state}`,
      JSON.stringify({
        clientId: parsed.clientId,
        redirectUri: parsed.redirectUri,
        verifier,
        createdAt: Date.now(),
      })
    );

    const authorize = new URL(
      "/oauth2/v1/authorize",
      configSignal.value.AUTH_SERVER_URL
    );
    authorize.searchParams.set("client_id", parsed.clientId);
    authorize.searchParams.set("redirect_uri", parsed.redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("scope", "openid profile offline_access");
    authorize.searchParams.set("locale", options.locale ?? "en");
    if (options.policy) authorize.searchParams.set("policy", options.policy);
    if (options.org) authorize.searchParams.set("org", options.org);
    window.location.assign(authorize.toString());
  } catch {
    errorSignal.value = "The account policy could not be opened.";
  }
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function base64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
