import type { PluginViewProps } from "@superboard/front-ui/context";

import { FlowUserDetailsPage } from "../source/features/flows/UserDetailsPage.js";
export default function View({ parameters }: PluginViewProps) {
	return <FlowUserDetailsPage userHash={parameters.id} />;
}
