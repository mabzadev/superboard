import type { PluginViewProps } from "@superboard/front-ui/context";

import Page from "../source/app/(protected)/dynamic-links/campaigns/[id]/page.js";
export default function View({ parameters }: PluginViewProps) {
	return <Page params={{ id: parameters.id }} />;
}
