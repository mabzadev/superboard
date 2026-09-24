import { Editor, Frame, useEditor } from "@craftjs/core";
import { Button } from "@superboard/front-ui/kumo";
import { renderToStaticMarkup } from "react-dom/server";

import { ButtonComponent } from "../components/craft/Button.js";
import { ContainerComponent } from "../components/craft/Container.js";
import { initialEditorState } from "../components/craft/Editor.js";
import { ImageComponent } from "../components/craft/Image.js";
import { RootContainer } from "../components/craft/RootContainer.js";
import { SettingsPanel } from "../components/craft/SettingsPanel.js";
import { TextComponent } from "../components/craft/Text.js";
import { Toolbox } from "../components/craft/Toolbox.js";
import { useStudioI18n } from "./i18n.js";

const resolver = {
	ButtonComponent,
	ContainerComponent,
	ImageComponent,
	RootContainer,
	TextComponent,
};

function initialState(html: string | null) {
	const stored = html?.match(
		/<script\s+id="craft-state"\s+type="application\/json">([\s\S]*?)<\/script>/u,
	)?.[1];
	if (stored) {
		try {
			const value: unknown = JSON.parse(stored);
			if (typeof value === "string") return value;
		} catch {
			/* Legacy HTML can be edited in the source field. */
		}
	}
	return JSON.stringify(initialEditorState);
}

export function InAppContentEditor({
	html,
	onApply,
}: {
	html: string | null;
	onApply: (html: string) => void;
}) {
	return (
		<Editor resolver={resolver}>
			<div className="grid min-h-[500px] gap-4 lg:grid-cols-[1fr_280px]">
				<div className="overflow-auto rounded-lg border border-kumo-line p-5">
					<Frame data={initialState(html)} />
				</div>
				<aside className="space-y-4 rounded-lg border border-kumo-line p-4">
					<Toolbox />
					<SettingsPanel />
					<ApplyContent onApply={onApply} />
				</aside>
			</div>
		</Editor>
	);
}

function ApplyContent({ onApply }: { onApply: (html: string) => void }) {
	const { query } = useEditor();
	const { t, locale } = useStudioI18n();
	return (
		<Button
			variant="primary"
			onClick={() => {
				const state = query.serialize();
				const body = renderToStaticMarkup(
					<Editor resolver={resolver} enabled={false}>
						<Frame data={state} />
					</Editor>,
				);
				onApply(
					`<!DOCTYPE html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body>${body}</body><script id="craft-state" type="application/json">${JSON.stringify(state).replaceAll("<", "\\u003c")}</script></html>`,
				);
			}}
		>
			{t("Apply content")}
		</Button>
	);
}
