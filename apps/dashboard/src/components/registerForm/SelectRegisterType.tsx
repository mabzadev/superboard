"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { useUserContext } from "@/context/useUserContext";
import LocalStorage from "@/lib/LocalStorage";
import googleIcon from "@/assets/icons/generic/Google.svg";
import microsoftIcon from "@/assets/icons/generic/Microsoft.svg";
import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

export function SelectRegisterType({ className, ...props }: LoginFormProps) {
  const router = useRouter();

  const { getSSOAuthenticationLink, userRef, isHydrated } = useUserContext();

  const handleRegisterWithEmail = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    router.replace("/register/with_email");
  };

  const handleSSOAuthWindow = (
    authWindow: Window | null,
    redirectURL: string,
    onSuccess: (response: {
      authToken: string | null;
      refreshToken: string | null;
      redirectUrl: string;
    }) => void,
    onFailure: (error?: Error) => void
  ) => {
    // Open a popup window for authentication
    authWindow = window.open(
      redirectURL,
      "SSOAuthWindow",
      "width=600,height=700"
    );

    if (!authWindow) {
      onFailure(
        new Error(
          "Popup window was blocked. Please allow popups for this site."
        )
      );
      return;
    }

    const currentHost = window.location.origin;
    let authCompleted = false;

    // Poll frequently to detect URL changes
    const checkInterval = setInterval(() => {
      if (authWindow.closed) {
        clearInterval(checkInterval);

        if (!authCompleted) {
          onFailure(
            new Error("Authentication window was closed before completion")
          );
        }
        return;
      }

      try {
        // This will throw if cross-origin
        const currentUrl = authWindow.location.href;

        // Check if we're back on our domain
        if (authWindow.location.origin === currentHost) {
          authCompleted = true;
          clearInterval(checkInterval);

          // Extract tokens from URL before any further redirects happen
          const url = new URL(currentUrl);
          const params = new URLSearchParams(url.search);

          // Get tokens from URL parameters
          const authToken =
            params.get("token") ||
            params.get("auth_token") ||
            params.get("access_token");
          const refreshToken = params.get("refresh_token");

          // Store tokens in sessionStorage
          if (authToken) {
            sessionStorage.setItem("authToken", authToken);
          }

          if (refreshToken) {
            sessionStorage.setItem("refreshToken", refreshToken);
          }

          // Close the window
          authWindow.close();

          // Trigger success callback with the tokens
          onSuccess({ authToken, refreshToken, redirectUrl: currentUrl });
        }
      } catch {
        // Cross-origin error - still in external auth flow
      }
    }, 50); // Poll frequently to catch the redirect quickly
  };

  const loginWithSSO = async (
    e: React.MouseEvent<HTMLButtonElement>,
    sso: string
  ) => {
    e.preventDefault();
    const width = 600;
    const height = 700;

    const topWindow = window.top ?? window;

    const y =
      (topWindow.outerHeight ?? window.innerHeight) / 2 +
      (topWindow.screenY ?? 0) -
      height / 2;

    const x =
      (topWindow.outerWidth ?? window.innerWidth) / 2 +
      (topWindow.screenX ?? 0) -
      width / 2;

    const authWindow = window.open(
      "",
      "SSOAuthWindow",
      `toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,copyhistory=no,width=${width},height=${height},top=${y},left=${x}`
    );
    // setIsLoading(true);
    try {
      const response = await getSSOAuthenticationLink(sso);
      // setIsLoading(false);
      const redirectURL = response.data.redirect_url;
      handleSSOAuthWindow(
        authWindow,
        redirectURL,
        (returnData: {
          authToken: string | null;
          refreshToken: string | null;
          redirectUrl: string;
        }) => {
          // Success callback
          if (returnData.authToken != null && returnData.refreshToken != null) {
            LocalStorage.setAuthenticationToken(returnData.authToken);
            LocalStorage.setRefreshToken(returnData.refreshToken);
            sessionStorage.removeItem("authToken");
            sessionStorage.removeItem("refreshToken");
          }
        },
        () => {
          // Failure callback — silently ignored
        }
      );
    } catch {
      // setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isHydrated) return;

    // Mount-only: userRef is a ref whose .current is read but shouldn't trigger re-runs
    if (userRef.current) {
      router.replace("/dashboard");
    }
  }, [isHydrated, router, userRef]);

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Get started</CardTitle>
        </CardHeader>
        <CardContent>
          <form>
            <div className="grid gap-6">
              <div className="flex flex-col gap-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={(e) => loginWithSSO(e, "google_oauth2")}
                >
                  <Image
                    src={googleIcon}
                    alt="Google Icon"
                    width={24}
                    height={24}
                  />
                  Continue with Google
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={(e) => loginWithSSO(e, "microsoft_graph")}
                >
                  <Image
                    src={microsoftIcon}
                    alt="Microsoft Icon"
                    width={24}
                    height={24}
                  />
                  Continue with Microsoft
                </Button>
              </div>
              <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                <span className="bg-card text-muted-foreground relative z-10 px-2">
                  Or
                </span>
              </div>
              <div className="grid gap-6">
                <div className="flex flex-col gap-4">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleRegisterWithEmail}
                  >
                    Register with email and password
                  </Button>
                </div>
                <div className="flex text-start text-sm gap-1">
                  Already a member?
                  <Link href="/login" className="underline underline-offset-4">
                    Sign in
                  </Link>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type LoginFormProps = React.ComponentProps<"div"> & {};
