import { cn } from "@/lib/utils";
import Image, { type StaticImageData } from "next/image";

const LinkTypeElement = ({
  title,
  subtitle,
  icon,
  selected,
  onClick,
  linkType: _linkType,
}: {
  linkType: string;
  title: string;
  subtitle: string;
  icon: StaticImageData;
  selected: boolean;
  onClick: () => void;
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-all duration-150",
        "hover:bg-muted hover:shadow-sm",
        selected
          ? "ring-2 ring-primary/20 border border-primary/30 bg-muted"
          : "border border-transparent"
      )}
    >
      <div className="flex items-center justify-center min-w-[32px] min-h-[32px] w-[32px] h-[32px]">
        <Image
          src={icon}
          alt="linkType"
          width={32}
          height={32}
          className="w-[32px] h-[32px]"
        />
      </div>
      <div className="flex flex-col">
        <p className="text-sm font-semibold">{title}</p>
        <span className="text-sm text-muted-foreground">{subtitle}</span>
      </div>
      <div className="ml-auto">
        <div
          className={cn(
            "h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors",
            selected
              ? "border-primary bg-primary"
              : "border-muted-foreground/30"
          )}
        >
          {selected && (
            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
          )}
        </div>
      </div>
    </div>
  );
};

export default LinkTypeElement;
