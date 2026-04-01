"use client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface PlatformAdsType {
  label: string;
  value: string;
  filterType?: string;
}

const AdsPlatformSelect = ({
  platformAdsOptions,
  selectedAdsPlatform,
  setSelectedAdsPlatforms,
  title,
  selectListTitle,
}: {
  platformAdsOptions: PlatformAdsType[];
  selectedAdsPlatform: string;
  setSelectedAdsPlatforms: (item: string) => void;
  title?: string;
  selectListTitle?: string;
}) => {
  const getValueLabelFromList = (value: string) => {
    const foundValue = platformAdsOptions.find((item) => item.value === value);

    if (foundValue) {
      if (foundValue.label === "All" && foundValue?.filterType === "ads") {
        return "Types";
      }
      if (
        foundValue.label === "All" &&
        foundValue?.filterType === "platforms"
      ) {
        return "Platforms";
      }

      return foundValue.label;
    }

    return title;
  };

  const changeBgColorForNonDefaultValues = () => {
    const foundValue = platformAdsOptions.find(
      (item) => item.value === selectedAdsPlatform
    );

    if (selectedAdsPlatform !== "" && foundValue?.filterType !== "users") {
      return "bg-foreground text-background dark:bg-foreground border-none";
    }

    return;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          role="combobox"
          className={cn(
            "cursor-pointer border-dashed whitespace-nowrap",
            changeBgColorForNonDefaultValues()
          )}
          variant={"outline"}
        >
          {getValueLabelFromList(selectedAdsPlatform)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2 space-y-2">
        {selectListTitle && (
          <div>
            <label className="text-sm text-muted-foreground">
              {selectListTitle}
            </label>
          </div>
        )}

        {platformAdsOptions.map((option: PlatformAdsType) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <Checkbox
              checked={selectedAdsPlatform === option.value}
              onCheckedChange={() => setSelectedAdsPlatforms(option.value)}
              id={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export default AdsPlatformSelect;
