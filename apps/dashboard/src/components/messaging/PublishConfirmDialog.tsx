import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Bell, Eye, Send, Smartphone, Users, UserPlus } from "lucide-react";
import { EXISTING_USERS_FILTER } from "@/constants/OptionsConstants";

const PublishConfirmDialog = ({
  open,
  onOpenChange,
  deliverTo,
  platformLabels,
  deliverPushNotification,
  autoDisplay,
  title,
  subtitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deliverTo: string;
  platformLabels: string;
  deliverPushNotification: boolean;
  autoDisplay: boolean;
  title: string;
  subtitle: string;
  onConfirm: () => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Publish Message</DialogTitle>
          <DialogDescription>
            Please review the following before publishing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-start gap-3 rounded-lg border border-sidebar-border bg-secondary p-3">
            {deliverTo === EXISTING_USERS_FILTER ? (
              <Users className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            ) : (
              <UserPlus className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {deliverTo === EXISTING_USERS_FILTER
                  ? "Existing Users"
                  : "New Users"}
              </span>
              <span className="text-xs text-muted-foreground">
                {deliverTo === EXISTING_USERS_FILTER
                  ? "This message will appear in the inbox of all your existing users."
                  : "This message will be shown to users who register after publishing."}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-sidebar-border bg-secondary p-3">
            <Smartphone className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Platforms</span>
              <span className="text-xs text-muted-foreground">
                Will be delivered on {platformLabels}.
              </span>
            </div>
          </div>

          {deliverPushNotification && deliverTo === EXISTING_USERS_FILTER && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3">
              <Bell className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Push Notification</span>
                <span className="text-xs text-muted-foreground">
                  Users with push notifications integrated will receive an alert
                  with the title &quot;{title}&quot; and subtitle &quot;
                  {subtitle}&quot;.
                </span>
              </div>
            </div>
          )}

          {autoDisplay && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3">
              <Eye className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Auto Display</span>
                <span className="text-xs text-muted-foreground">
                  This message will automatically display as a full-screen
                  overlay when users open the app.
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            <Send className="h-4 w-4" />
            Confirm Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PublishConfirmDialog;
