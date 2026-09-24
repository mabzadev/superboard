import { Element, useEditor } from "@craftjs/core";
import { Button } from "@superboard/front-ui/kumo";
import {
	BoxSelect,
	CircleDotDashed,
	GripVertical,
	Logs,
	ScanFace,
	SquareDashedKanban,
} from "lucide-react";

import { useStudioI18n } from "../../studio/i18n.js";
import { ButtonComponent } from "./Button.js";
import { ContainerComponent } from "./Container.js";
import { ImageComponent } from "./Image.js";
import { TextComponent } from "./Text.js";

export const Toolbox = () => {
	const { connectors, actions, query } = useEditor();
	const { t } = useStudioI18n();

	const items = [
		{
			label: "Text",
			icon: Logs,
			create: <TextComponent text={t("Text")} />,
		},
		{
			label: "Button",
			icon: CircleDotDashed,
			create: <ButtonComponent text={t("Button")} />,
		},
		{
			label: "Container",
			icon: BoxSelect,
			create: <Element is={ContainerComponent} canvas />,
		},
		{
			label: "Image",
			icon: ScanFace,
			create: <Element is={ImageComponent} canvas />,
		},
	];

	return (
		<div className="flex flex-col p-3 gap-1">
			<div className="flex items-center gap-2 px-1 mb-1">
				<SquareDashedKanban className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					{t("Components")}
				</span>
			</div>

			{items.map((item) => {
				const Icon = item.icon;
				return (
					<Button
						variant="ghost"
						onClick={() => {
							actions.addNodeTree(query.parseReactElement(item.create).toNodeTree(), "ROOT");
						}}
						key={item.label}
						className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-grab hover:bg-sidebar-accent/50 transition-colors"
						ref={(ref) => {
							if (ref) connectors.create(ref, item.create);
						}}
					>
						<Icon className="h-4 w-4 text-muted-foreground shrink-0" />
						<span>{t(item.label)}</span>
						<GripVertical className="ms-auto h-3 w-3 text-muted-foreground/40" />
					</Button>
				);
			})}
		</div>
	);
};
