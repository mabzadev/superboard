import { toast } from "sonner";

export const showGenericError = (): void => {
  toast.error("Something went wrong, please try again");
};

export const showSuccessNotification = (message: string): void => {
  toast.success(message);
};

export const showExportNotification = (): void => {
  toast.success(
    "We're preparing your CSV. You'll receive an email with a download link valid for 24 hours.",
    { duration: 10000 }
  );
};

export const showErrorNotification = (message: string): void => {
  toast.error(message);
};

export const showErrorNotificationWithLink = (
  message: string,
  onSuccess: () => void
): void => {
  toast.error(message, {
    action: {
      label: "View",
      onClick: onSuccess,
    },
  });
};
