import LinksPageContent from "@/components/dynamic_links/links/LinksPageContent";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LinksPageContent campaignId={id} />;
}
