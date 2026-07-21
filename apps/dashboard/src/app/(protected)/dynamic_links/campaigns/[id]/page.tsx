import LinksPage from "../../links/page";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <LinksPage campaignId={id} />;
}
