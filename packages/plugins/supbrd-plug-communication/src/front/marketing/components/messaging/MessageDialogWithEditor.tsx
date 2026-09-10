"use client";

import { Editor } from "@craftjs/core";

import type { Notification } from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import { ButtonComponent } from "../craft/Button.js";
import { ContainerComponent } from "../craft/Container.js";
import { ImageComponent } from "../craft/Image.js";
import { RootContainer } from "../craft/RootContainer.js";
import { TextComponent } from "../craft/Text.js";
import MessageDialog from "./MessageDialog.js";

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
