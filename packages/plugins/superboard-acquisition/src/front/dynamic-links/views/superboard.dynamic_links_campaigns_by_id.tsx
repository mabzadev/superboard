import type { PluginViewProps } from "@superboard/front-ui/context";

import DynamicLinksWorkspace from "../components/dynamic_links/DynamicLinksWorkspace.js";
export default function View({ parameters }: PluginViewProps) {
	return <DynamicLinksWorkspace campaignId={parameters.id} />;
}
