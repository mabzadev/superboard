import { z } from "zod";
import { isURL } from "validator";

export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .regex(
    /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    "Email is not valid"
  );

export const nameSchema = z
  .string()
  .min(3, "Name must be at least 3 characters");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

export const httpUrlSchema = z.string().refine(
  (url) => {
    if (!url) return false;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return false;
    const localhostRegx = /^(http:\/\/|https:\/\/)localhost:\d+/;
    return (
      isURL(url, { require_protocol: true, protocols: ["http", "https"] }) ||
      localhostRegx.test(url)
    );
  },
  { message: "Enter a valid URL (must start with http:// or https://)" }
);

export const bundleIdSchema = z
  .string()
  .regex(
    /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*$/,
    "Invalid bundle ID format"
  );

export const shaSchema = z.string().refine(
  (input) => {
    const reg = input.replace(/[^a-zA-Z0-9 ]/g, "");
    return reg.length === 64;
  },
  { message: "Invalid SHA format" }
);
