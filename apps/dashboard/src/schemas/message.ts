import { z } from "zod";

export const messageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  subtitle: z.string().min(1, "Subtitle is required"),
  selectedPlatforms: z.array(z.string()).min(1, "Select at least one platform"),
  deliverTo: z.string(),
  autoDisplay: z.boolean(),
  deliverPushNotification: z.boolean(),
});

export type MessageFormValues = z.infer<typeof messageSchema>;
