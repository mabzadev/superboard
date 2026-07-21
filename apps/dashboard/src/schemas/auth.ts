import { z } from "zod";
import { emailSchema, nameSchema, passwordSchema } from "./shared";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(3, "Password is required"),
  otp: z.string().optional(),
});

export const loginWithOtpSchema = loginSchema.extend({
  otp: z.string().min(6, "OTP must be at least 6 characters"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type LoginWithOtpFormValues = z.infer<typeof loginWithOtpSchema>;

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    password_confirm: z.string(),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Passwords do not match",
    path: ["password_confirm"],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

export const resetPasswordSchema = z.object({
  email: emailSchema,
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    password_confirm: z.string(),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Passwords do not match",
    path: ["password_confirm"],
  });

export type NewPasswordFormValues = z.infer<typeof newPasswordSchema>;
