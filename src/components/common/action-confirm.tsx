import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ActionConfirmProps = {
  open: boolean;
  setOpen: (e: boolean) => void;
  onConfirm: () => void | Promise<void>;

  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  showCloseButton?: boolean;
};

const ActionConfirm = ({
  open,
  setOpen,
  onConfirm,
  title = "Are you absolutely sure?",
  description = "This action cannot be undone. This will permanently delete the item.",
  confirmText = "Delete",
  cancelText = "Cancel",
  showCloseButton = true,
}: ActionConfirmProps) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* <DialogTrigger asChild>

        <div onClick={() => setOpen(true)}>{children}</div>
      </DialogTrigger> */}

      <DialogContent showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Deleting..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ActionConfirm;
