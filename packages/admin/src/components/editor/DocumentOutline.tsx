import { Button, Collapsible, Text } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { CaretDown } from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import * as React from "react";

import { cn } from "../../lib/utils";

function getIndentClass(level: number) {
	switch (level) {
		case 1:
			return "ps-2";
		case 2:
			return "ps-6";
		case 3:
			return "ps-10";
		default:
			return "ps-2";
	}
}

function getTextClass(level: number) {
	switch (level) {
		case 1:
			return "font-medium";
		case 2:
			return "font-normal";
		case 3:
			return "font-normal text-kumo-subtle";
		default:
			return "font-normal";
	}
}

export interface HeadingItem {
	level: number;
	text: string;
	pos: number;
	key: string;
}

export function extractHeadings(editor: Editor | null): HeadingItem[] {
	if (!editor) return [];

	const headings: HeadingItem[] = [];
	const doc = editor.state.doc;
	let key = 0;

	doc.descendants((node, pos) => {
		if (node.type.name === "heading") {
			const rawLevel = node.attrs.level;
			const level = typeof rawLevel === "number" ? rawLevel : 1;
			const text = node.textContent || "";
			if (text.trim()) {
				headings.push({
					level,
					text,
					pos,
					key: `heading-${key++}`,
				});
			}
		}
	});

	return headings;
}

export function findCurrentHeading(headings: HeadingItem[], cursorPos: number): HeadingItem | null {
	if (headings.length === 0) return null;

	let current: HeadingItem | null = null;
	for (const heading of headings) {
		if (heading.pos <= cursorPos) {
			current = heading;
		} else {
			break;
		}
	}

	return current;
}

export interface DocumentOutlineProps {
	editor: Editor | null;
	className?: string;
	reserveHeaderEnd?: boolean;
}

export function DocumentOutline({
	editor,
	className,
	reserveHeaderEnd = false,
}: DocumentOutlineProps) {
	const { t } = useLingui();
	const [isExpanded, setIsExpanded] = React.useState(true);
	const [headings, setHeadings] = React.useState<HeadingItem[]>([]);
	const [currentPos, setCurrentPos] = React.useState(0);

	React.useEffect(() => {
		if (!editor) return;

		const updateHeadings = () => {
			setHeadings(extractHeadings(editor));
		};

		updateHeadings();

		editor.on("update", updateHeadings);

		return () => {
			editor.off("update", updateHeadings);
		};
	}, [editor]);

	React.useEffect(() => {
		if (!editor) return;

		const updatePosition = () => {
			const { from } = editor.state.selection;
			setCurrentPos(from);
		};

		updatePosition();

		editor.on("selectionUpdate", updatePosition);

		return () => {
			editor.off("selectionUpdate", updatePosition);
		};
	}, [editor]);

	const currentHeading = findCurrentHeading(headings, currentPos);

	const handleHeadingClick = (heading: HeadingItem) => {
		if (!editor) return;

		editor.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
	};

	return (
		<Collapsible.Root className={className} open={isExpanded} onOpenChange={setIsExpanded}>
			<Collapsible.Trigger
				render={
					<Button
						variant="ghost"
						className="relative justify-between"
						style={{
							width: reserveHeaderEnd ? "calc(100% - 1.5rem)" : "calc(100% + 1.5rem)",
							insetInlineStart: "-0.75rem",
						}}
					/>
				}
			>
				<Text bold as="span">
					{t`Outline`}
				</Text>
				<CaretDown
					className={cn(
						"h-4 w-4 text-kumo-subtle transition-transform duration-150 ease-out motion-reduce:transition-none",
						isExpanded && "rotate-180",
					)}
				/>
			</Collapsible.Trigger>

			<Collapsible.Panel
				className="-mx-2 overflow-hidden duration-150 ease-out [&[hidden]:not([hidden='until-found'])]:hidden motion-reduce:transition-none"
				style={({ transitionStatus }) => ({
					height:
						transitionStatus === "starting" || transitionStatus === "ending"
							? 0
							: "var(--collapsible-panel-height)",
					transitionProperty: "height",
				})}
			>
				<div className="space-y-0.5 pt-2">
					{headings.length === 0 ? (
						<p className="text-sm text-kumo-subtle px-2 py-1">{t`No headings in document`}</p>
					) : (
						headings.map((heading) => {
							const isCurrent = currentHeading?.key === heading.key;
							return (
								<button
									key={heading.key}
									type="button"
									onClick={() => handleHeadingClick(heading)}
									className={cn(
										"w-full text-start px-2 py-1 text-sm rounded-md transition-colors",
										"hover:bg-kumo-tint/50 cursor-pointer",
										"truncate",
										getIndentClass(heading.level),
										getTextClass(heading.level),
										isCurrent && "bg-kumo-tint text-kumo-default",
									)}
									title={heading.text}
								>
									{heading.text}
								</button>
							);
						})
					)}
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
