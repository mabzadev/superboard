import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./kumo.js";
import { PaywallDragItem, PaywallDragProvider, PaywallDropEnd } from "./paywall-drag.js";

type Screen = { id: string; name: string };

export function OnboardingSidebar({
	screens,
	selectedId,
	panel,
	t,
	onPanel,
	onSelect,
	onAdd,
	onReorder,
	preview,
	children,
}: {
	screens: Screen[];
	selectedId?: string;
	panel: string;
	t: (key: string) => string;
	onPanel: (panel: string) => void;
	onSelect: (id: string) => void;
	onAdd: () => void;
	onReorder: (id: string, index: number) => void;
	preview: (id: string) => ReactNode;
	children: ReactNode;
}) {
	return (
		<aside className="onboarding-sidebar" aria-label={t("Onboarding screens")}>
			<nav className="onboarding-panel-tabs" aria-label={t("Editor tools")}>
				{["Screens", "Elements"].map((name) => (
					<Button
						key={name}
						variant={panel === name ? "secondary" : "ghost"}
						aria-pressed={panel === name}
						onClick={() => {
							onPanel(name);
						}}
					>
						{t(name)}
					</Button>
				))}
			</nav>
			{panel === "Screens" ? (
				<PaywallDragProvider
					onInsert={(item, index) => {
						onReorder(item.value, index);
					}}
				>
					<div className="onboarding-screen-list paywall-layer-panel">
						{screens.map((screen, index) => (
							<PaywallDragItem
								key={screen.id}
								source={{ kind: "block", value: screen.id }}
								index={index}
								className="onboarding-screen-card"
								data-selected={screen.id === selectedId}
								onPick={() => {
									onSelect(screen.id);
								}}
							>
								<Button
									variant="ghost"
									className="onboarding-screen-select"
									aria-pressed={screen.id === selectedId}
									onClick={() => {
										onSelect(screen.id);
									}}
								>
									<span className="onboarding-screen-number">{index + 1}.</span>
									<span className="onboarding-screen-name">{screen.name}</span>
								</Button>
								<div className="onboarding-thumbnail" aria-hidden="true">
									<div inert>{preview(screen.id)}</div>
								</div>
								<div className="onboarding-screen-actions" data-paywall-no-drag>
									<Button
										variant="ghost"
										size="xs"
										shape="square"
										aria-label={t("Move screen up")}
										disabled={index === 0}
										onClick={() => {
											onReorder(screen.id, index - 1);
										}}
									>
										<ArrowUp size={13} />
									</Button>
									<Button
										variant="ghost"
										size="xs"
										shape="square"
										aria-label={t("Move screen down")}
										disabled={index === screens.length - 1}
										onClick={() => {
											onReorder(screen.id, index + 2);
										}}
									>
										<ArrowDown size={13} />
									</Button>
								</div>
							</PaywallDragItem>
						))}
						<PaywallDropEnd index={screens.length} label={t("Drop here")} />
					</div>
					<footer className="onboarding-sidebar-footer">
						<Button variant="primary" onClick={onAdd}>
							<Plus size={16} />
							{t("Add screen")}
						</Button>
					</footer>
				</PaywallDragProvider>
			) : (
				children
			)}
		</aside>
	);
}
