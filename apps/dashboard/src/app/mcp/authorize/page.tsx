"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  ExternalLink,
  X,
  FolderOpen,
  Link2,
  BarChart3,
  Settings2,
  CheckCircle2,
} from "lucide-react";
import Image from "next/image";
import OpenGrowIcon from "@/assets/icons/ads_platform/opengrow.svg";
import LocalStorage from "@/lib/LocalStorage";
import { approveConsentAPICall } from "@/api/mcp/mcpService";
import { currentUserAPICall } from "@/api/auth/userService";
import type { User } from "@/types/user";
import { ApiError } from "@/lib/ApiError";

function McpAuthorizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedCallbackUrl, setApprovedCallbackUrl] = useState<string | null>(
    null
  );

  const clientId = searchParams.get("client_id") || "";
  const clientName = searchParams.get("client_name") || "";
  const redirectUri = searchParams.get("redirect_uri") || "";
  const codeChallenge = searchParams.get("code_challenge") || undefined;
  const codeChallengeMethod =
    searchParams.get("code_challenge_method") || undefined;
  const state = searchParams.get("state") || undefined;
  const scope = searchParams.get("scope") || undefined;

  // Check auth on mount
  useEffect(() => {
    const token = LocalStorage.getAuthenticationToken();
    if (!token) {
      const currentUrl = window.location.pathname + window.location.search;
      router.replace(`/login?backTo=${encodeURIComponent(currentUrl)}`);
      return;
    }

    currentUserAPICall()
      .then((res) => {
        setUser(res.data.user);
        setIsLoading(false);
      })
      .catch(() => {
        const currentUrl = window.location.pathname + window.location.search;
        router.replace(`/login?backTo=${encodeURIComponent(currentUrl)}`);
      });
  }, [router]);

  const handleApprove = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await approveConsentAPICall({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        state,
        scope,
      });

      const { code, state: returnedState } = response.data;

      // Build the MCP client's callback URL with the auth code
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", code);
      if (returnedState) {
        callbackUrl.searchParams.set("state", returnedState);
      }
      const callbackUrlStr = callbackUrl.toString();

      // Render the success view first so the user always sees a clear confirmation,
      // even if the browser intercepts navigation as a universal link and stays on
      // this page instead of actually navigating away.
      setApprovedCallbackUrl(callbackUrlStr);
      setIsSubmitting(false);
      // Trigger the redirect on the next tick so React has a chance to render
      // the success view before navigation (which may be preempted by an OS-level
      // universal link handler).
      window.setTimeout(() => {
        window.location.href = callbackUrlStr;
      }, 50);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setIsSubmitting(false);
    }
  }, [clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope]);

  const handleReturnToClient = useCallback(() => {
    if (approvedCallbackUrl) {
      window.location.href = approvedCallbackUrl;
    }
  }, [approvedCallbackUrl]);

  const handleCloseWindow = useCallback(() => {
    window.close();
  }, []);

  const handleDeny = useCallback(() => {
    try {
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("error", "access_denied");
      if (state) {
        callbackUrl.searchParams.set("state", state);
      }
      window.location.href = callbackUrl.toString();
    } catch {
      setError("Invalid redirect URI. Cannot return to application.");
    }
  }, [redirectUri, state]);

  if (isLoading) {
    return (
      <div className="bg-muted flex min-h-svh flex-col items-center justify-center w-full">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading...
        </div>
      </div>
    );
  }

  const clientDisplayName = clientName || "An application";

  if (approvedCallbackUrl) {
    return (
      <div className="bg-muted flex min-h-svh flex-col items-center justify-center w-full p-4">
        <Card className="w-full max-w-[420px] shadow-lg">
          <CardHeader className="flex flex-col items-center gap-3 pb-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <h2 className="text-lg font-semibold">
                Authorization Successful
              </h2>
              <p className="text-sm text-muted-foreground">
                You&apos;ve granted{" "}
                <span className="font-medium text-foreground">
                  {clientDisplayName}
                </span>{" "}
                access to your OpenGrow account.
              </p>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <div className="rounded-lg bg-muted/50 border border-sidebar-border p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  {clientDisplayName}
                </span>{" "}
                should open automatically. If it doesn&apos;t, click the button
                below to return.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-2">
            <Button
              variant="default"
              className="w-full"
              onClick={handleReturnToClient}
            >
              <ExternalLink className="h-4 w-4" />
              Return to {clientDisplayName}
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={handleCloseWindow}
            >
              Close this window
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center w-full p-4">
      <Card className="w-full max-w-[420px] shadow-lg">
        <CardHeader className="flex flex-col items-center gap-3 pb-2">
          <Image src={OpenGrowIcon} alt="OpenGrow" width={44} height={44} />
          <div className="flex flex-col items-center gap-1 text-center">
            <h2 className="text-lg font-semibold">Authorize Connection</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {clientDisplayName}
              </span>{" "}
              wants to access your OpenGrow account.
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm px-1">
            <span className="text-muted-foreground">Signed in as</span>
            <span className="font-medium">{user?.email}</span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold px-1">Permissions</span>
            <div className="rounded-xl border border-sidebar-border overflow-hidden divide-y divide-sidebar-border">
              <div className="flex items-center gap-3 px-4 py-3">
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">
                  View your projects and instances
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">Create and manage links</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">View analytics data</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Settings2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm">
                  Configure redirects and SDK settings
                </span>
              </div>
            </div>
          </div>

          {redirectUri &&
            (() => {
              try {
                const host = new URL(redirectUri).host;
                return (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ExternalLink className="h-3 w-3" />
                    <span>Redirecting to {host}</span>
                  </div>
                );
              } catch {
                return null;
              }
            })()}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="destructive"
            className="flex-1"
            onClick={handleDeny}
            disabled={isSubmitting}
          >
            <X className="h-4 w-4" />
            Deny
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onClick={handleApprove}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Authorizing..." : "Authorize"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function McpAuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="bg-muted flex min-h-svh flex-col items-center justify-center w-full">
          <div className="animate-pulse text-muted-foreground text-sm">
            Loading...
          </div>
        </div>
      }
    >
      <McpAuthorizeContent />
    </Suspense>
  );
}
