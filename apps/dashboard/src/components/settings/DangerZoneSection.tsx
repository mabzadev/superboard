import DeleteConfirm from "@/components/common/delete-confirm";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "../ui/button";

const DangerZoneSection = ({
  handleRemoveProject,
}: {
  handleRemoveProject: () => void;
}) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-destructive">
          Danger Zone
        </span>
        <span className="text-xs text-muted-foreground">
          Irreversible actions that permanently affect this project.
        </span>
      </div>

      <div className="rounded-xl border border-destructive/20 overflow-hidden">
        <div className="px-5 py-5 flex items-center gap-4 bg-gradient-to-r from-destructive/5 to-destructive/[0.02]">
          <div className="flex items-center justify-center h-11 w-11 rounded-xl shrink-0 bg-destructive/10 ring-1 ring-destructive/15">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-sm font-semibold">Delete this project</span>
            <span className="text-xs text-muted-foreground leading-snug">
              Permanently remove all links, data, and shared resources. This
              cannot be undone.
            </span>
          </div>
          <DeleteConfirm onConfirm={handleRemoveProject}>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Project
            </Button>
          </DeleteConfirm>
        </div>
      </div>
    </div>
  );
};

export default DangerZoneSection;
