import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const CreateLinkTrackingSection = ({
  source,
  setSource,
  medium,
  setMedium,
  campaignName,
  setCampaignName,
  disabledActions,
}: {
  source: string;
  medium: string;
  campaignName: string;
  setSource: (value: string) => void;
  setMedium: (value: string) => void;
  setCampaignName: (value: string) => void;
  disabledActions?: boolean;
}) => {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        <div className="flex flex-col gap-6 px-6 py-6">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">UTM Tracking</label>
            <span className="text-xs text-muted-foreground">
              These parameters are appended to your redirect URLs to track
              traffic sources in Google Analytics, Play Store, or App Store.
            </span>
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Source</label>
            <Input
              className="transition-all focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10"
              placeholder="e.g. google, newsletter, twitter"
              value={source}
              readOnly={disabledActions}
              onChange={(e) => setSource(e.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">
              Identifies where the traffic is coming from.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Medium</label>
            <Input
              className="transition-all focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10"
              placeholder="e.g. cpc, email, social"
              value={medium}
              readOnly={disabledActions}
              onChange={(e) => setMedium(e.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">
              Identifies the marketing channel or type of link.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Campaign</label>
            <Input
              className="transition-all focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10"
              placeholder="e.g. spring_sale, product_launch"
              value={campaignName}
              readOnly={disabledActions}
              onChange={(e) => setCampaignName(e.currentTarget.value)}
            />
            <span className="text-xs text-muted-foreground">
              Identifies the specific campaign or promotion.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateLinkTrackingSection;
