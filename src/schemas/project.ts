import { z } from "zod";
import { emailSchema } from "./shared";

export const createProjectSchema = z.object({
  name: z.string().min(3, "Project name must be at least 3 characters"),
  members: z
    .array(
      z.object({
        email: emailSchema,
        role: z.string(),
      })
    )
    .default([]),
});

export type CreateProjectFormValues = z.infer<typeof createProjectSchema>;

export const createCampaignSchema = z.object({
  name: z.string().min(3, "Campaign name must be at least 3 characters"),
});

export type CreateCampaignFormValues = z.infer<typeof createCampaignSchema>;
