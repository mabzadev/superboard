import LinksPageContent from "../../links/LinksPageContent";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <LinksPageContent campaignId={id} />;
}
