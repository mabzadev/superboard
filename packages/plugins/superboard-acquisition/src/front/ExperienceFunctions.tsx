import { useCallback, useState } from "react";

import { ComponentsPage } from "./flows/features/flows/ComponentsPage.js";
import { WorkflowEditorPage } from "./flows/features/flows/editor/WorkflowEditorPage.js";
import { FlowsProvider } from "./flows/features/flows/FlowsContext.js";
import { useFlowI18n } from "./flows/features/flows/i18n.js";
import { LaunchpadPage } from "./flows/features/flows/LaunchpadPage.js";
import { FlowsWorkflowsPage } from "./flows/features/flows/WorkflowsPage.js";

export function ExperienceFunctions({
	section,
	onDirtyChange,
}: {
	section: string;
	onDirtyChange: (dirty: boolean) => void;
}) {
	const { tr } = useFlowI18n();
	const [workflowId, setWorkflowId] = useState("");
	const [dirty, setDirty] = useState(false);
	const changed = useCallback(
		(value: boolean) => {
			setDirty(value);
			onDirtyChange(value);
		},
		[onDirtyChange],
	);
	return (
		<div hidden={!["Workflows", "Launchpad", "Components"].includes(section)}>
			<FlowsProvider>
				<p className="text-sm text-muted-foreground">
					{tr("These functions are shared by the experiences in this project.")}
				</p>
				<div hidden={section !== "Workflows"}>
					{workflowId ? (
						<WorkflowEditorPage
							workflowId={workflowId}
							onDirtyChange={changed}
							onBack={() => {
								if (dirty && !window.confirm(tr("Discard unsaved changes?"))) return;
								changed(false);
								setWorkflowId("");
							}}
						/>
					) : (
						section === "Workflows" && <FlowsWorkflowsPage onOpen={setWorkflowId} />
					)}
				</div>
				{section === "Launchpad" && <LaunchpadPage />}
				{section === "Components" && <ComponentsPage />}
			</FlowsProvider>
		</div>
	);
}
