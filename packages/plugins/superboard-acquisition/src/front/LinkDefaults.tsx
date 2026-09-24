import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";

import CampaignsPageContent from "./dynamic-links/components/dynamic_links/campaigns/CampaignsPageContent.js";
import DomainPageContent from "./dynamic-links/components/dynamic_links/domain/DomainPageContent.js";
import RedirectRulesPageContent from "./dynamic-links/components/dynamic_links/redirect-rules/RedirectRulesPageContent.js";
import SocialPreviewPageContent from "./dynamic-links/components/dynamic_links/social-preview/SocialPreviewPageContent.js";
import TrackingPageContent from "./dynamic-links/components/dynamic_links/tracking/TrackingPageContent.js";
import { useFlowI18n } from "./flows/features/flows/i18n.js";

export function LinkDefaults() {
	const { tr } = useFlowI18n();
	return (
		<Tabs defaultValue="domain">
			<TabsList className="h-auto flex-wrap">
				<TabsTrigger value="domain">{tr("Domain")}</TabsTrigger>
				<TabsTrigger value="campaigns">{tr("Campaigns")}</TabsTrigger>
				<TabsTrigger value="routing">{tr("Redirect rules")}</TabsTrigger>
				<TabsTrigger value="preview">{tr("Social preview")}</TabsTrigger>
				<TabsTrigger value="tracking">{tr("Tracking")}</TabsTrigger>
			</TabsList>
			<TabsContent value="domain">
				<DomainPageContent />
			</TabsContent>
			<TabsContent value="campaigns">
				<CampaignsPageContent />
			</TabsContent>
			<TabsContent value="routing">
				<RedirectRulesPageContent />
			</TabsContent>
			<TabsContent value="preview">
				<SocialPreviewPageContent />
			</TabsContent>
			<TabsContent value="tracking">
				<TrackingPageContent />
			</TabsContent>
		</Tabs>
	);
}
