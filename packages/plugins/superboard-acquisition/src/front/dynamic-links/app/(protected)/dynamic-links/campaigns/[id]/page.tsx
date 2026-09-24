import LinksPageContent from "../../../../../components/dynamic_links/links/LinksPageContent.js";

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
	const { id } = params;
	return <LinksPageContent campaignId={id} />;
}
