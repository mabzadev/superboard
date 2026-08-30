import type { ReactNode } from "react";

import CreateCampaignGlobalDialogProvider from "../../../dashboard/src/context/useCreateCampaignDialogContext";
import LinkDialogProvider from "../../../dashboard/src/context/useLinkDialogContext";
import { FlowsProvider } from "../../../dashboard/src/features/flows/FlowsContext";
import QueryProvider from "../../../dashboard/src/lib/QueryProvider";
import { ProjectSelectionProvider } from "../compat/dashboard-project-context";

export function SuperBoardFrontProviders({
	children,
	instanceId,
	productionProjectRef,
	testProjectRef,
}: {
	children: ReactNode;
	instanceId: string;
	productionProjectRef?: string;
	testProjectRef?: string;
}) {
	return (
		<ProjectSelectionProvider
			instanceId={instanceId}
			productionProjectRef={productionProjectRef}
			testProjectRef={testProjectRef}
		>
			<QueryProvider>
				<FlowsProvider>
					<LinkDialogProvider>
						<CreateCampaignGlobalDialogProvider>
							{children}
						</CreateCampaignGlobalDialogProvider>
					</LinkDialogProvider>
				</FlowsProvider>
			</QueryProvider>
		</ProjectSelectionProvider>
	);
}
