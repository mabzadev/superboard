import { isURL } from "validator";

export const isLocalhost = (value: string) => {
  try {
    const url = new URL(value);
    return url.hostname === "localhost";
  } catch {
    return false;
  }
};

export const isDomainValid = (value: string) =>
  isURL(value, {
    require_protocol: true,
    protocols: ["http", "https"],
    require_tld: !isLocalhost(value),
  });
