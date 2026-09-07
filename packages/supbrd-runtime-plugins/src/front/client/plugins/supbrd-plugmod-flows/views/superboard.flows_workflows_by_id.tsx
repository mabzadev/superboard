import type { PluginViewProps } from "@superboard/front-ui/context";

import { WorkflowEditorPage } from "../source/features/flows/editor/WorkflowEditorPage.js";
export default function View({ parameters }: PluginViewProps) {
	return <WorkflowEditorPage workflowId={parameters.id} />;
}
