import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import type { MessageFormValues } from "@/schemas/message";

const CreateMessageOverview = ({
  form,
  readOnly,
  showErrors,
}: {
  form: UseFormReturn<MessageFormValues>;
  readOnly?: boolean;
  showErrors?: boolean;
}) => {
  const title = form.watch("title");
  const subtitle = form.watch("subtitle");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Title</label>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
          >
            Required
          </Badge>
        </div>
        <Input
          readOnly={readOnly}
          placeholder="Enter the title of the message"
          {...form.register("title")}
          className={cn(
            "transition-all",
            title.length > 0
              ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
              : showErrors
                ? "border-destructive/50 ring-[3px] ring-destructive/10"
                : "border-amber-300/50 ring-[2px] ring-amber-200/10"
          )}
        />
        {showErrors && title.length === 0 && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            Title is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          This will be used as a title of the push notification, and will be
          shown in the messages list.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Subtitle</label>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
          >
            Required
          </Badge>
        </div>
        <Input
          readOnly={readOnly}
          placeholder="Enter the subtitle of the message"
          {...form.register("subtitle")}
          className={cn(
            "transition-all",
            subtitle.length > 0
              ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
              : showErrors
                ? "border-destructive/50 ring-[3px] ring-destructive/10"
                : "border-amber-300/50 ring-[2px] ring-amber-200/10"
          )}
        />
        {showErrors && subtitle.length === 0 && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            Subtitle is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          This will be used as a subtitle of the push notification, and will be
          shown in the messages list.
        </span>
      </div>
    </div>
  );
};

export default CreateMessageOverview;
