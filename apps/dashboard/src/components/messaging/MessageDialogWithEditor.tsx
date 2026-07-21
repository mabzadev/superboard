"use client";

import { Editor } from "@craftjs/core";
import { ButtonComponent } from "@/components/craft/Button";
import { TextComponent } from "@/components/craft/Text";
import { ContainerComponent } from "@/components/craft/Container";
import { RootContainer } from "@/components/craft/RootContainer";
import { ImageComponent } from "@/components/craft/Image";
import MessageDialog from "./MessageDialog";
import type { Notification } from "@/types";

const resolver = {
  ButtonComponent,
  TextComponent,
  ContainerComponent,
  RootContainer,
  ImageComponent,
};

export interface MessageDialogWithEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getMessages: () => void;
  selectedMessage?: Notification | null;
  enabled?: boolean;
  isArchived?: boolean;
}

const MessageDialogWithEditor = ({
  open,
  onOpenChange,
  getMessages,
  selectedMessage,
  enabled = true,
  isArchived = false,
}: MessageDialogWithEditorProps) => {
  return (
    <Editor resolver={resolver} enabled={enabled}>
      <MessageDialog
        open={open}
        onOpenChange={onOpenChange}
        getMessages={getMessages}
        selectedMessage={selectedMessage}
        isArchived={isArchived}
      />
    </Editor>
  );
};

export default MessageDialogWithEditor;
