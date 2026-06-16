"use client";
import AppHeader from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DeleteConfirm from "@/components/common/delete-confirm";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showGenericError } from "@/lib/Notifications";
import { cn } from "@/lib/utils";
import CustomDomainSetup from "@/components/configuration/CustomDomainSetup";
import MigrationEntry from "@/components/migration/MigrationEntry";

import { AlertCircle, Check, Globe, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  useDomainConfigQuery,
  useCustomDomainQuery,
} from "@/hooks/queries/useConfigurationQueries";
import {
  useSetSubdomainMutation,
  useVerifySubdomainMutation,
} from "@/hooks/mutations/useConfigurationMutations";

const DomainPage = () => {
  const { selectedProject } = useProjectSelection();

  const projectId = selectedProject?.id;

  const { data: projectDomain } = useDomainConfigQuery(projectId);
  // When a custom subdomain is active it becomes the link base URL, so it
  // takes over the Subdomain field instead of the default grovs one.
  const { data: customDomain } = useCustomDomainQuery(projectId);
  const customActive = customDomain?.status === "active";

  const setSubdomainMutation = useSetSubdomainMutation(projectId);
  const verifySubdomainMutation = useVerifySubdomainMutation(projectId);

  const [appDomain, setAppDomain] = useState<string>("");
  const [appSubdomain, setAppSubdomain] = useState<string>("");
  const [changes, setChanges] = useState<boolean>(false);
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean>(true);

  const { mutateAsync: verifySubdomain } = verifySubdomainMutation;

  const handleVerifySubdomainAvailability = useCallback(
    async (subdomain: string) => {
      if (!subdomain) {
        setSubdomainAvailable(false);
        return;
      }

      if (subdomain === projectDomain!.subdomain) {
        setSubdomainAvailable(true);
        return;
      }

      try {
        const response = await verifySubdomain(subdomain);
        setSubdomainAvailable(response.data.available);
      } catch {}
    },
    [projectDomain, verifySubdomain]
  );

  const checkChanges = useCallback(() => {
    if (!projectDomain) {
      return;
    }
    if (
      projectDomain.subdomain !== appSubdomain &&
      appSubdomain !== "" &&
      appSubdomain?.length >= 5
    ) {
      setChanges(true);
    } else {
      setChanges(false);
    }
  }, [projectDomain, appSubdomain]);

  const handleSetSubdomain = async () => {
    const formData = new FormData();
    formData.append("subdomain", appSubdomain);
    if (projectDomain?.generic_title) {
      formData.append("generic_title", projectDomain.generic_title);
    }
    if (projectDomain?.generic_subtitle) {
      formData.append("generic_subtitle", projectDomain.generic_subtitle);
    }
    if (projectDomain?.generic_image_url) {
      formData.append("generic_image_url", projectDomain.generic_image_url);
    }
    if (projectDomain?.google_tracking_id) {
      formData.append("google_tracking_id", projectDomain.google_tracking_id);
    }
    try {
      await setSubdomainMutation.mutateAsync(formData);
    } catch {
      showGenericError();
    }
  };

  const handleDiscard = () => {
    if (!projectDomain) return;
    setAppSubdomain(projectDomain.subdomain);
    setAppDomain(projectDomain.domain);
  };

  // Data fetching is handled automatically by useDomainConfigQuery

  let isCurrentSettingValid = false;

  if (appSubdomain) {
    isCurrentSettingValid =
      appSubdomain + appDomain !== appDomain &&
      appSubdomain?.length >= 5 &&
      subdomainAvailable;
  } else {
    isCurrentSettingValid = appDomain != null && subdomainAvailable;
  }

  const hasSubdomainChanged =
    projectDomain && appSubdomain !== projectDomain.subdomain;
  const subdomainTooShort =
    hasSubdomainChanged && appSubdomain.length > 0 && appSubdomain.length < 5;
  const subdomainUnavailable =
    hasSubdomainChanged && appSubdomain.length >= 5 && !subdomainAvailable;

  // Data fetching on project change is handled by useDomainConfigQuery

  useEffect(() => {
    if (!projectDomain) {
      return;
    }

    setAppSubdomain(projectDomain.subdomain);
    setAppDomain(projectDomain.domain);
  }, [projectDomain]);

  useEffect(() => {
    if (!selectedProject || !projectDomain) {
      return;
    }

    checkChanges();
    handleVerifySubdomainAvailability(appSubdomain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSubdomain, projectDomain, selectedProject]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
            {/* Sticky save bar */}
            <div
              className={cn(
                "sticky top-0 z-10 transition-all duration-300 overflow-hidden bg-sidebar/80 backdrop-blur-md px-6 flex items-center justify-between",
                changes && subdomainAvailable
                  ? "max-h-16 opacity-100 border-b border-sidebar-border py-3"
                  : "max-h-0 opacity-0 border-b-0 py-0"
              )}
            >
              <span className="text-xs text-muted-foreground">
                Unsaved changes in Subdomain
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="pl-3 pr-4"
                  onClick={handleDiscard}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <DeleteConfirm
                  confirmText="Yes, Change domain"
                  title="Warning"
                  description="This will invalidate all your previous links. Changing the domain will require updating the app links as well. Be aware that previously released apps won't be able to open the links anymore, and developers will need to reconfigure the grovs SDK to accommodate this change. Are you sure you want to proceed?"
                  onConfirm={handleSetSubdomain}
                >
                  <Button size="sm" className="pl-3 pr-4">
                    <Save className="h-3.5 w-3.5" />
                    Save Changes
                  </Button>
                </DeleteConfirm>
              </div>
            </div>

            <div className="flex flex-col gap-0 px-6 py-4 max-w-[800px]">
              {/* Subdomain section */}
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">Subdomain</span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      All your links will use this subdomain as their base URL.
                    </span>
                  </div>
                </div>

                {!customActive && (
                  <div className="flex flex-col gap-3">
                    <div
                      className={cn(
                        "flex items-center rounded-md border bg-muted/30 px-4 py-3 transition-all",
                        subdomainTooShort || subdomainUnavailable
                          ? "border-destructive/50 ring-[3px] ring-destructive/10"
                          : isCurrentSettingValid
                            ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                            : "border-sidebar-border"
                      )}
                    >
                      <span className="text-sm text-muted-foreground select-none">
                        https://
                      </span>
                      <input
                        className="text-sm font-medium bg-transparent outline-none border-b border-dashed border-muted-foreground/40 focus:border-primary px-0.5 mx-0.5 transition-colors"
                        style={{
                          width: `${Math.max(appSubdomain.length, 8)}ch`,
                        }}
                        placeholder="subdomain"
                        value={appSubdomain}
                        onChange={(e) => {
                          const val = e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]/g, "");
                          setAppSubdomain(val);
                        }}
                      />
                      <span className="text-sm text-muted-foreground select-none">
                        .{appDomain}
                      </span>
                      <div className="ml-auto pl-3">
                        {isCurrentSettingValid && (
                          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                            <Check className="h-3 w-3 text-valid-green" />
                          </div>
                        )}
                      </div>
                    </div>
                    {subdomainTooShort && (
                      <Badge
                        variant="destructive"
                        className="w-fit gap-1.5 py-1 px-2.5"
                      >
                        <AlertCircle className="h-3 w-3" />
                        Subdomain must be at least 5 characters
                      </Badge>
                    )}
                    {subdomainUnavailable && (
                      <Badge
                        variant="destructive"
                        className="w-fit gap-1.5 py-1 px-2.5"
                      >
                        <AlertCircle className="h-3 w-3" />
                        This subdomain is not available
                      </Badge>
                    )}
                  </div>
                )}

                {/* Use your own subdomain (replaces the field when active) */}
                <CustomDomainSetup projectId={projectId} />
                <MigrationEntry projectId={projectId} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DomainPage;
