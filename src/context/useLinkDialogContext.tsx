"use client";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useMemo,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@radix-ui/react-dialog";
import { Separator } from "@/components/ui/separator";
import { Plus, Save, Trash2, Workflow, X } from "lucide-react";
import dynamic from "next/dynamic";

const RedirectPreviewModal = dynamic(
  () => import("@/components/dynamic_links/links/RedirectPreviewModal"),
  { ssr: false, loading: () => null }
);
import { resolveRedirects } from "@/hooks/useResolvedRedirects";
import {
  useRedirectConfigQuery,
  useCustomDomainQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { NO_CHECK, PARTIAL_CHECK } from "@/constants/OptionsConstants";
import LinkDialogContent from "@/components/dynamic_links/links/create_link/LinkDialogContent";
import CreateLinkCreatedSuccessfully from "@/components/dynamic_links/links/create_link/CreateLinkCreatedSuccessfully";
import { useProjectSelection } from "./useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { clsx } from "clsx";
import { trackEvent, EVENTS } from "@/analytics";
import { useCreateLinkForm } from "@/hooks/useCreateLinkForm";
import ActionConfirm from "@/components/common/action-confirm";
import DeleteConfirm from "@/components/common/delete-confirm";
import RedirectRulesGateDialog from "@/components/common/redirect-rules-gate-dialog";
import { mapKeyPairValues } from "@/lib/utils";
import { buildLinkFormData } from "@/lib/buildLinkFormData";
import {
  hasEditChanges,
  disableEditButton,
  getEditFirstErrorSection,
  type LinkEditFormValues,
} from "@/hooks/useLinkEditValidation";
import type { Link } from "@/types";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  useRandomPathQuery,
  usePathAvailableQuery,
} from "@/hooks/queries/useLinksQueries";
import {
  useCreateLinkMutation,
  useUpdateLinkMutation,
  useRemoveLinkMutation,
} from "@/hooks/mutations/useLinksMutations";
import { getLinksByIdAPICall } from "@/api/links/linksService";

type DialogOptions = {
  onConfirm?: (...args: unknown[]) => Promise<void> | void;
  campaignID?: string;
  onSuccess?: () => void;
};

type LinkDialogContextType = {
  openLinkDialog: (options: DialogOptions) => void;
  openEditLinkDialog: (link: Pick<Link, "id">, options: DialogOptions) => void;
};

const LinkDialogContext = createContext<LinkDialogContextType | undefined>(
  undefined
);

const LinkDialogProvider = ({ children }: { children: ReactNode }) => {
  const { selectedProject, selectedInstance } = useProjectSelection();
  const queryClient = useQueryClient();
  const projectId = selectedProject?.id;

  const { data: projectRedirectsConfig } = useRedirectConfigQuery(projectId);
  // When a custom subdomain is active it becomes the link base URL.
  const { data: customDomain } = useCustomDomainQuery(projectId);
  const customActiveHostname =
    customDomain?.status === "active" ? customDomain.hostname : null;

  const createLinkMutation = useCreateLinkMutation(
    projectId,
    selectedInstance?.id
  );
  const updateLinkMutation = useUpdateLinkMutation(projectId);
  const removeLinkMutation = useRemoveLinkMutation(projectId);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);
  const isBusy =
    createLinkMutation.isPending ||
    updateLinkMutation.isPending ||
    removeLinkMutation.isPending ||
    isLoadingEdit;

  const [domain, setDomain] = useState<string>("");
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [options, setOptions] = useState<DialogOptions>({});
  const [selectedLink, setSelectedLink] = useState<Link | null>(null);
  const [createdLink, setCreatedLink] = useState<Link | null>(null);
  const [isLinkGenerated, setIsLinkGenerated] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [initialKeyPair, setInitialKeyPair] = useState<
    { key: string; value: string }[]
  >([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [redirectGateOpen, setRedirectGateOpen] = useState(false);
  const [debouncedPath, setDebouncedPath] = useState<string>("");

  const form = useCreateLinkForm();

  const { data: randomPath } = useRandomPathQuery(projectId, mode === "create");
  const { data: pathAvailable } = usePathAvailableQuery(
    projectId,
    !mode
      ? undefined
      : mode === "edit" && debouncedPath === selectedLink?.path
        ? undefined
        : debouncedPath
  );

  const isOpen = mode !== null;

  const disabledActions = useMemo(() => {
    if (mode !== "edit" || !selectedLink) return false;
    return !selectedLink.active;
  }, [mode, selectedLink]);

  const resolvedRedirects = resolveRedirects(
    {
      androidRedirectURL: form.androidRedirectURL,
      androidRedirectType: form.androidRedirectType,
      iosRedirectURL: form.iOSRedirectURL,
      iosRedirectType: form.iOSRedirectType,
      desktopRedirectURL: form.desktopRedirectURL,
      desktopRedirectType: form.desktopRedirectType,
      showPreviewAndroid: form.showPreviewAndroid,
      showPreviewIOS: form.showPreviewIOS,
    },
    projectRedirectsConfig ?? null
  );

  // --- Form values for edit validation ---

  const editFormValues: LinkEditFormValues = {
    name: form.name,
    path: form.path,
    linkType: form.linkType,
    socialMediaTitle: form.socialMediaTitle,
    socialMediaSubTitle: form.socialMediaSubTitle,
    imageType: form.imageType,
    imageFile: form.imageFile,
    imageLink: form.imageLink,
    tagList: form.tagList,
    iOSRedirectURL: form.iOSRedirectURL,
    iOSRedirectType: form.iOSRedirectType,
    androidRedirectURL: form.androidRedirectURL,
    androidRedirectType: form.androidRedirectType,
    desktopRedirectURL: form.desktopRedirectURL,
    desktopRedirectType: form.desktopRedirectType,
    showPreviewIOS: form.showPreviewIOS,
    showPreviewAndroid: form.showPreviewAndroid,
    utmCampaign: form.utmCampaign,
    utmMedium: form.utmMedium,
    utmSource: form.utmSource,
    keyValuePair: form.keyValuePair,
    pathAvailable: form.pathAvailable,
  };

  // --- Open handlers ---

  const openLinkDialog = useCallback(
    (opts: DialogOptions) => {
      if (!projectRedirectsConfig?.default_fallback) {
        setRedirectGateOpen(true);
        return;
      }
      form.handleCloseWindow();
      setOptions(opts);
      setMode("create");
    },
    [projectRedirectsConfig?.default_fallback, form]
  );

  const { initializeFromLink } = form;

  const openEditLinkDialog = useCallback(
    async (link: Pick<Link, "id">, opts: DialogOptions) => {
      form.handleCloseWindow();
      setOptions(opts);
      setIsLoadingEdit(true);
      try {
        const response = await getLinksByIdAPICall(projectId!, {
          ids: [link.id],
        });
        const fullLink = response.data.links[0];
        if (!fullLink) return;
        setSelectedLink(fullLink);
        initializeFromLink(fullLink);
        setInitialKeyPair(mapKeyPairValues(fullLink.data));
        setMode("edit");
      } catch (error) {
        showErrorNotification(
          error instanceof ApiError
            ? error.message
            : "Something went wrong, please try again"
        );
      } finally {
        setIsLoadingEdit(false);
      }
    },
    [projectId, initializeFromLink, form]
  );

  // --- Close / discard ---

  const closeDialog = () => {
    setShowErrors(false);
    setMode(null);
    setTimeout(() => {
      setSelectedLink(null);
      setCreatedLink(null);
      setIsLinkGenerated(false);
      setInitialKeyPair([]);
    }, 300);
  };

  const handleClose = () => {
    if (mode === "create" && !isLinkGenerated && form.hasChanges()) {
      setShowDiscardConfirm(true);
    } else if (
      mode === "edit" &&
      selectedLink &&
      hasEditChanges(editFormValues, selectedLink, initialKeyPair)
    ) {
      setShowDiscardConfirm(true);
    } else {
      closeDialog();
    }
  };

  const handleDiscard = () => {
    setShowDiscardConfirm(false);
    closeDialog();
  };

  // --- Sections ---

  const editSections = [
    { text: "Details", value: "details", checked: "" },
    {
      text: "Social Media Preview",
      value: "social_media_preview",
      checked: "",
    },
    { text: "Data", value: "data", checked: "" },
    { text: "Redirects", value: "redirects", checked: "" },
    { text: "Tracking", value: "tracking", checked: "" },
  ];

  const createSections = form.sections.map((s) => ({
    ...s,
    checked: s.checked === PARTIAL_CHECK ? NO_CHECK : s.checked,
  }));

  const currentSections = mode === "edit" ? editSections : createSections;

  // --- API actions ---

  const buildFormData = () =>
    buildLinkFormData({
      ...editFormValues,
      mode: mode!,
      campaignID: options.campaignID,
      selectedLinkImage: selectedLink?.image ?? "",
    });

  const handleCreate = async () => {
    if (form.hasDuplicateKeys(form.keyValuePair)) {
      showErrorNotification("You have duplicate keys");
      return;
    }
    try {
      const response = await createLinkMutation.mutateAsync(buildFormData());
      const link = response.data.link;
      setCreatedLink(link);
      setIsLinkGenerated(true);
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId!),
      });
      trackEvent(EVENTS.LINK_CREATED, { linkId: link.id });
      options?.onSuccess?.();
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleSave = async () => {
    if (form.hasDuplicateKeys(form.keyValuePair)) {
      showErrorNotification("You have duplicate keys");
      return;
    }
    try {
      await updateLinkMutation.mutateAsync({
        linkId: selectedLink!.id,
        formData: buildFormData(),
      });
      options?.onSuccess?.();
      showSuccessNotification("Link edited");
      closeDialog();
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleArchive = async () => {
    try {
      await removeLinkMutation.mutateAsync(selectedLink!.id);
      options.onSuccess?.();
      closeDialog();
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  // --- Button click handlers ---

  const isCreateDisabled = form.disabledCreateButton();

  const handleCreateClick = () => {
    if (isCreateDisabled) {
      form.setSection(form.getFirstErrorSection());
      setShowErrors(true);
    } else {
      handleCreate();
    }
  };

  const handleSaveClick = () => {
    if (
      !selectedLink ||
      disableEditButton(editFormValues, selectedLink, initialKeyPair)
    ) {
      if (selectedLink)
        form.setSection(getEditFirstErrorSection(editFormValues, selectedLink));
      setShowErrors(true);
    } else {
      handleSave();
    }
  };

  // --- Effects ---

  useEffect(() => {
    if (!selectedProject) return;
    const base = customActiveHostname ?? selectedProject.domain;
    setDomain("https://" + base + "/");
  }, [selectedProject, customActiveHostname]);

  const { setPath, setPathAvailable, path: formPath } = form;

  useEffect(() => {
    if (mode === "create" && randomPath) {
      setPath(randomPath);
    }
  }, [mode, randomPath, setPath]);

  useEffect(() => {
    if (!formPath) {
      setDebouncedPath("");
      return;
    }
    const timeout = setTimeout(() => {
      setDebouncedPath(formPath);
    }, 250);
    return () => clearTimeout(timeout);
  }, [formPath]);

  useEffect(() => {
    if (!mode) return;
    if (mode === "edit" && formPath === selectedLink?.path) {
      setPathAvailable(true);
      return;
    }
    if (debouncedPath && pathAvailable !== undefined) {
      setPathAvailable(pathAvailable);
    }
  }, [
    pathAvailable,
    debouncedPath,
    mode,
    selectedLink?.path,
    formPath,
    setPathAvailable,
  ]);

  // --- Render ---

  const hasChangesNow = selectedLink
    ? hasEditChanges(editFormValues, selectedLink, initialKeyPair)
    : false;

  const contextValue = useMemo(
    () => ({ openLinkDialog, openEditLinkDialog }),
    [openLinkDialog, openEditLinkDialog]
  );

  return (
    <LinkDialogContext.Provider value={contextValue}>
      {children}
      <RedirectRulesGateDialog
        open={redirectGateOpen}
        onOpenChange={setRedirectGateOpen}
      />
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent
          aria-describedby="link-dialog-description"
          showCloseButton={false}
          className={clsx(
            "flex flex-col p-0 gap-0 overflow-hidden border-sidebar-border",
            mode === "create" && isLinkGenerated
              ? "sm:max-w-[480px] w-full h-fit"
              : "xl:max-w-[1200px] w-full sm:max-w-[90vw] max-h-[950px] h-full h-[90vh]"
          )}
        >
          <DialogDescription id="link-dialog-description" className="sr-only">
            Create or edit a dynamic link
          </DialogDescription>

          {/* Header */}
          {mode === "create" && isLinkGenerated ? (
            <DialogHeader className="sr-only">
              <DialogTitle>Link created</DialogTitle>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4 p-4 w-full">
                  <DialogTitle className="font-semibold text-md">
                    {mode === "create"
                      ? "Create Link"
                      : selectedLink?.active
                        ? "Edit Link"
                        : "Archived Link"}
                  </DialogTitle>
                  <button
                    className="ml-auto"
                    onClick={handleClose}
                    aria-label="Close dialog"
                  >
                    <X />
                  </button>
                </div>
              </DialogHeader>
              <Separator />
            </>
          )}

          {/* Body */}
          <div
            className={clsx(
              "flex overflow-hidden",
              mode === "create" && isLinkGenerated ? "" : "h-full"
            )}
          >
            {mode === "create" && isLinkGenerated ? (
              <CreateLinkCreatedSuccessfully
                createdLink={createdLink}
                onClose={() => closeDialog()}
              />
            ) : (
              <LinkDialogContent
                sections={currentSections}
                section={form.section}
                setSection={form.setSection}
                disabledActions={disabledActions}
                showErrors={showErrors}
                form={form}
                domain={domain}
              />
            )}
          </div>

          {/* Footer */}
          {mode === "create" && !isLinkGenerated && (
            <>
              <Separator />
              <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Workflow className="h-3.5 w-3.5" />
                  Preview paths
                </Button>
                <Button
                  onClick={handleCreateClick}
                  disabled={isBusy}
                  aria-busy={isBusy}
                >
                  <Plus />
                  {createLinkMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </div>
            </>
          )}

          {mode === "edit" && selectedLink?.active && (
            <>
              <Separator />
              <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                  <DeleteConfirm
                    title="Archive link"
                    description="Are you sure you want to archive this link?"
                    confirmText="Archive"
                    onConfirm={handleArchive}
                  >
                    <Button
                      variant="outline"
                      className="shadow-none text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                      Archive
                    </Button>
                  </DeleteConfirm>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewOpen(true)}
                  >
                    <Workflow className="h-3.5 w-3.5" />
                    Preview paths
                  </Button>
                </div>
                {hasChangesNow && (
                  <Button
                    onClick={handleSaveClick}
                    disabled={isBusy}
                    aria-busy={isBusy}
                  >
                    <Save />
                    {updateLinkMutation.isPending
                      ? "Saving..."
                      : "Save changes"}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <RedirectPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        resolvedRedirects={resolvedRedirects}
        linkUrl={domain + (form.path || "")}
      />
      <ActionConfirm
        open={showDiscardConfirm}
        setOpen={setShowDiscardConfirm}
        onConfirm={handleDiscard}
        title="Discard unsaved changes?"
        description="You have unsaved changes that will be lost if you close this dialog."
        confirmText="Discard"
        cancelText="Continue editing"
      />
    </LinkDialogContext.Provider>
  );
};

export const useGlobalLinkDialog = () => {
  const context = useContext(LinkDialogContext);
  if (!context)
    throw new Error("useLinkDialog must be used within LinkDialogProvider");
  return context;
};

export default LinkDialogProvider;
