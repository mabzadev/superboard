import { z } from "zod";
import { emailSchema } from "./shared";

export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.string().min(1, "Role is required"),
});

export type AddMemberFormValues = z.infer<typeof addMemberSchema>;
