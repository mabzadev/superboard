import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { Monitor, Smartphone, X } from "lucide-react";

const MessagePreviewDialog = ({
  previewHtml,
  onClose,
}: {
  previewHtml: string;
  onClose: () => void;
}) => {
  const [previewDevice, setPreviewDevice] = useState<"web" | "mobile">("web");

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col p-0 gap-0 overflow-hidden border-sidebar-border xl:max-w-[90vw] w-full sm:max-w-[90vw] max-h-[90vh] h-[90vh]"
      >
        <DialogDescription className="sr-only">
          Message preview
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b">
          <DialogTitle className="text-sm font-semibold">
            Message Preview
          </DialogTitle>

          <div className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground">
            <button
              onClick={() => setPreviewDevice("web")}
              aria-pressed={previewDevice === "web"}
              aria-label="Web preview"
              className={`inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium transition-[color,box-shadow] ${
                previewDevice === "web"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              <Monitor className="h-4 w-4" />
              Web
            </button>
            <button
              onClick={() => setPreviewDevice("mobile")}
              aria-pressed={previewDevice === "mobile"}
              aria-label="Mobile preview"
              className={`inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium transition-[color,box-shadow] ${
                previewDevice === "mobile"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              Mobile
            </button>
          </div>

          <button onClick={onClose} aria-label="Close preview">
            <X />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 flex items-center justify-center overflow-hidden bg-muted/30 p-6">
          {previewDevice === "web" ? (
            <iframe
              srcDoc={previewHtml}
              className="w-full h-full rounded-lg border shadow-md bg-white"
              sandbox="allow-scripts allow-popups"
              title="Message preview — Web"
            />
          ) : (
            <iframe
              srcDoc={previewHtml}
              className="rounded-md border shadow-md bg-white max-w-[390px] max-h-[844px] w-full h-full"
              sandbox="allow-scripts allow-popups"
              title="Message preview — Mobile"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MessagePreviewDialog;
