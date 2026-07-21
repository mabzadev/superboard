import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { AlertCircle, Plus, Trash2, X } from "lucide-react";
import { Badge } from "../ui/badge";
import CreateMessageOverview from "./CreateMessageOverview";
import CreateMessageDelivery from "./CreateMessageDelivery";
import { deepEqual } from "@/lib/utils";
import {
  ANDROID,
  EXISTING_USERS_FILTER,
  FULL_CHECK,
  IOS,
  NEW_USERS_FILTER,
  NO_CHECK,
  WEB,
} from "@/constants/OptionsConstants";
import {
  useCreateNotificationMutation,
  useArchiveNotificationMutation,
} from "@/hooks/mutations/useNotificationsMutations";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import CreateMessageContent from "./CreateMessageContent";
import LocalStorage from "@/lib/LocalStorage";
import { Editor, Frame, useEditor } from "@craftjs/core";
import { ButtonComponent } from "../craft/Button";
import { TextComponent } from "../craft/Text";
import { ContainerComponent } from "../craft/Container";
import { RootContainer } from "../craft/RootContainer";
import { ImageComponent } from "../craft/Image";
import { ExportHtmlButton } from "../craft/ExportButton";
import { PreviewOnlyButton } from "../craft/PreviewOnlyButton";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEditorState } from "../craft/Editor";
import ActionConfirm from "@/components/common/action-confirm";
import { Separator } from "../ui/separator";
import CreateLinkSidebar from "../dynamic_links/links/create_link/CreateLinkSidebar";
import PublishConfirmDialog from "./PublishConfirmDialog";
import MessagePreviewDialog from "./MessagePreviewDialog";
import type { Notification, CreateNotificationApiPayload } from "@/types";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { messageSchema, type MessageFormValues } from "@/schemas/message";

const PLATFORMS_LIST = [
  { label: "iOS", value: IOS },
  { label: "Android", value: ANDROID },
  { label: "Web", value: WEB },
];

const messageDefaultValues: MessageFormValues = {
  title: "",
  subtitle: "",
  selectedPlatforms: [],
  deliverTo: EXISTING_USERS_FILTER,
  autoDisplay: false,
  deliverPushNotification: false,
};

const MessageDialog = ({
  open,
  onOpenChange,
  getMessages,
  selectedMessage,
  isArchived = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getMessages: () => void;
  selectedMessage?: Notification | null;
  isArchived?: boolean;
}) => {
  const mode = selectedMessage ? "view" : "create";

  const { selectedProject } = useProjectSelection();
  const createNotificationMutation = useCreateNotificationMutation(
    selectedProject?.id
  );
  const archiveNotificationMutation = useArchiveNotificationMutation(
    selectedProject?.id
  );
  const [openConfirm, setOpenConfirm] = useState<boolean>(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState<boolean>(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState<boolean>(false);
  const [showErrors, setShowErrors] = useState<boolean>(false);
  const [section, setSection] = useState<string>("details");
  const [htmlMessage, setHtmlMessage] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const form = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: messageDefaultValues,
    mode: "onChange",
  });

  const title = form.watch("title");
  const subtitle = form.watch("subtitle");
  const selectedPlatforms = form.watch("selectedPlatforms");
  const deliverTo = form.watch("deliverTo");
  const autoDisplay = form.watch("autoDisplay");
  const deliverPushNotification = form.watch("deliverPushNotification");

  const resolver = useMemo(
    () => ({
      ButtonComponent,
      TextComponent,
      ContainerComponent,
      RootContainer,
      ImageComponent,
    }),
    []
  );

  const { json, actions: editorActions } = useEditor((_state, query) => ({
    json: query.serialize(),
  }));

  const editorActionsRef = useRef(editorActions);
  editorActionsRef.current = editorActions;

  const generateHtmlFromJson = React.useCallback(
    (json: string) => {
      const content = renderToStaticMarkup(
        <Editor resolver={resolver} enabled={false}>
          <Frame data={json} />
        </Editor>
      );

      return `
<!DOCTYPE html>
<html lang="en" class="">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Exported Page</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body style="margin:0;padding:0;background:#fff">
    ${content}
  </body>
  <script id="craft-state" type="application/json">
    ${json.replace(/</g, "\\u003c")}
  </script>
</html>`;
    },
    [resolver]
  );

  const html = generateHtmlFromJson(json);

  const detailsComplete = useMemo(() => {
    return title !== "" && subtitle !== "" && selectedPlatforms.length > 0;
  }, [title, subtitle, selectedPlatforms]);

  const contentComplete = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      const rootNodes = parsed?.ROOT?.nodes || [];
      return rootNodes.length > 0;
    } catch {
      return false;
    }
  }, [json]);

  const sections = useMemo(
    () => [
      {
        text: "Details",
        value: "details",
        checked: detailsComplete ? FULL_CHECK : NO_CHECK,
      },
      {
        text: "Content",
        value: "content",
        checked: contentComplete ? FULL_CHECK : NO_CHECK,
      },
    ],
    [detailsComplete, contentComplete]
  );

  const viewSections = useMemo(
    () => [
      { text: "Details", value: "details", checked: FULL_CHECK },
      { text: "Content", value: "content", checked: FULL_CHECK },
    ],
    []
  );

  const handlePublishClick = () => {
    if (!detailsComplete) {
      setShowErrors(true);
      setSection("details");
      return;
    }
    if (!contentComplete) {
      setShowErrors(true);
      setSection("content");
      return;
    }
    setPublishConfirmOpen(true);
  };

  const platformLabels = selectedPlatforms
    .map((p) => PLATFORMS_LIST.find((pl) => pl.value === p)?.label)
    .filter(Boolean)
    .join(", ");

  const handleCreateNotification = async () => {
    if (!selectedProject) return;
    const values = form.getValues();
    const isExistingUsers = values.deliverTo === EXISTING_USERS_FILTER;
    const createObject: CreateNotificationApiPayload = {
      project_id: selectedProject.id,
      title: values.title,
      subtitle: values.subtitle,
      platforms: values.selectedPlatforms,
      new_users: !isExistingUsers,
      existing_users: isExistingUsers,
      html: html ?? undefined,
      send_push: isExistingUsers ? values.deliverPushNotification : false,
      auto_display: values.autoDisplay,
    };

    try {
      await createNotificationMutation.mutateAsync(createObject);
      setHtmlMessage(null);
      getMessages();
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleArchiveMessage = async () => {
    if (!selectedMessage) return;
    try {
      await archiveNotificationMutation.mutateAsync(selectedMessage.id);
      showSuccessNotification("Message archived");
      getMessages();
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 422 &&
        (error.data as Record<string, unknown>)?.error
      ) {
        showErrorNotification(
          (error.data as Record<string, unknown>).error as string
        );
      } else if (error instanceof ApiError) {
        showErrorNotification(error.message);
      }
    }
  };

  const handleOpenChange = (e: boolean) => {
    if (e) return;

    if (mode === "view") {
      onOpenChange(false);
      return;
    }

    if (deepEqual(JSON.parse(json), initialEditorState)) {
      onOpenChange(false);
    } else {
      setOpenConfirm(true);
    }
  };

  const prevOpenRef = useRef(open);
  const prevMessageRef = useRef(selectedMessage);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    const prevMessage = prevMessageRef.current;
    prevOpenRef.current = open;
    prevMessageRef.current = selectedMessage;

    // Reset when dialog closes
    if (wasOpen && !open) {
      form.reset(messageDefaultValues);
      setShowErrors(false);
      setSection("details");
      setHtmlMessage(null);
      setPreviewHtml(null);
      LocalStorage.removeCraftPreview();
      editorActionsRef.current.deserialize(JSON.stringify(initialEditorState));
      return;
    }

    // Load message data when opening in view mode (or message changes while open)
    if (
      open &&
      mode === "view" &&
      selectedMessage &&
      selectedMessage !== prevMessage
    ) {
      form.reset({
        title: selectedMessage.title,
        subtitle: selectedMessage.subtitle,
        selectedPlatforms: selectedMessage.target.platforms,
        autoDisplay: selectedMessage.auto_display,
        deliverTo: selectedMessage.target.existing_users
          ? EXISTING_USERS_FILTER
          : NEW_USERS_FILTER,
        deliverPushNotification: selectedMessage.send_push,
      });
      setSection("details");
      setHtmlMessage(selectedMessage.html ?? null);
    }
  }, [open, selectedMessage, mode]); // eslint-disable-line react-hooks/exhaustive-deps -- form/editorActionsRef are stable refs

  const isReadOnly = mode === "view";
  const canArchive = isReadOnly && selectedMessage && !isArchived;

  return (
    <>
      <ActionConfirm
        title="Are you sure you want to discard changes?"
        description="You have content changes, do you want to close the window and discard all changes?"
        confirmText="Discard Changes"
        open={openConfirm}
        setOpen={setOpenConfirm}
        onConfirm={() => onOpenChange(false)}
      />

      <ActionConfirm
        title="Archive message?"
        description="This message will be permanently archived and can no longer be delivered to users."
        confirmText="Archive"
        open={archiveConfirmOpen}
        setOpen={setArchiveConfirmOpen}
        onConfirm={handleArchiveMessage}
      />

      <PublishConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        deliverTo={deliverTo}
        platformLabels={platformLabels}
        deliverPushNotification={deliverPushNotification}
        autoDisplay={autoDisplay}
        title={title}
        subtitle={subtitle}
        onConfirm={() => {
          setPublishConfirmOpen(false);
          handleCreateNotification();
        }}
      />

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          aria-describedby="message-dialog-description"
          showCloseButton={false}
          className="flex flex-col p-0 gap-0 overflow-hidden border-sidebar-border xl:max-w-[1200px] w-full sm:max-w-[90vw] max-h-[950px] h-full h-[90vh]"
        >
          <DialogDescription
            id="message-dialog-description"
            className="sr-only"
          >
            Create or view a message
          </DialogDescription>

          {/* Header */}
          <DialogHeader>
            <div className="flex items-center gap-4 p-4 w-full">
              <DialogTitle className="font-semibold text-md">
                {mode === "create" ? "Create Message" : "Message Preview"}
              </DialogTitle>
              <button
                className="ml-auto"
                onClick={() => handleOpenChange(false)}
                aria-label="Close dialog"
              >
                <X />
              </button>
            </div>
          </DialogHeader>

          <Separator />

          {/* Body: Sidebar + Content */}
          <div className="flex h-full w-full overflow-hidden">
            <CreateLinkSidebar
              sections={mode === "view" ? viewSections : sections}
              section={section}
              setSection={setSection}
            />

            <div className="flex flex-1 flex-col w-full min-h-0">
              {/* Details section: Overview + Delivery combined */}
              {section === "details" && (
                <div className="flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-6 px-6 py-6 max-w-[800px]">
                    <CreateMessageOverview
                      form={form}
                      readOnly={isReadOnly}
                      showErrors={showErrors}
                    />

                    <Separator />

                    <CreateMessageDelivery
                      form={form}
                      options={PLATFORMS_LIST}
                      readOnly={isReadOnly}
                      showErrors={showErrors}
                    />
                  </div>
                </div>
              )}

              {/* Content section */}
              {section === "content" && (
                <div className="flex flex-1 flex-col min-h-0">
                  {showErrors && !contentComplete && (
                    <div className="px-6 pt-4">
                      <Badge
                        variant="destructive"
                        className="w-fit gap-1.5 py-1 px-2.5"
                      >
                        <AlertCircle className="h-3 w-3" />
                        Add at least one component to the content
                      </Badge>
                    </div>
                  )}
                  {isReadOnly && htmlMessage ? (
                    <div className="flex-1 overflow-hidden bg-muted/30 p-4">
                      <iframe
                        srcDoc={htmlMessage}
                        className="w-full h-full bg-white rounded-md border"
                        sandbox="allow-scripts"
                        title="Message content"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <CreateMessageContent
                        setHtmlMessage={setHtmlMessage}
                        htmlMessage={htmlMessage}
                        readOnlyMode={isReadOnly}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <Separator />
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            {mode === "create" ? (
              <>
                <ExportHtmlButton
                  htmlMessage={htmlMessage}
                  setHtmlMessage={setHtmlMessage}
                  onPreview={setPreviewHtml}
                />
                <Button onClick={handlePublishClick}>
                  <Plus />
                  Publish
                </Button>
              </>
            ) : (
              <>
                <PreviewOnlyButton
                  htmlMessage={htmlMessage}
                  onPreview={setPreviewHtml}
                />
                {canArchive && (
                  <Button
                    variant="outline"
                    className="shadow-none text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setArchiveConfirmOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Archive
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {previewHtml && (
        <MessagePreviewDialog
          previewHtml={previewHtml}
          onClose={() => setPreviewHtml(null)}
        />
      )}
    </>
  );
};

export default MessageDialog;
