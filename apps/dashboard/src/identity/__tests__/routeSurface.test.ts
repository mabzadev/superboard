import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const expectedMelodyPages = [
  "account/page.tsx",
  "apps/[id]/page.tsx",
  "apps/banners/[id]/page.tsx",
  "apps/banners/new/page.tsx",
  "apps/new/page.tsx",
  "apps/page.tsx",
  "dashboard/page.tsx",
  "logs/email/[id]/page.tsx",
  "logs/page.tsx",
  "logs/sign-in/[id]/page.tsx",
  "logs/sms/[id]/page.tsx",
  "orgs/[id]/page.tsx",
  "orgs/new/page.tsx",
  "orgs/page.tsx",
  "page.tsx",
  "roles/[id]/page.tsx",
  "roles/new/page.tsx",
  "roles/page.tsx",
  "saml/[id]/page.tsx",
  "saml/new/page.tsx",
  "saml/page.tsx",
  "scopes/[id]/page.tsx",
  "scopes/new/page.tsx",
  "scopes/page.tsx",
  "user-attributes/[id]/page.tsx",
  "user-attributes/new/page.tsx",
  "user-attributes/page.tsx",
  "users/[authId]/page.tsx",
  "users/page.tsx",
] as const;

describe("Melody admin route surface", () => {
  it("keeps every imported Melody administration page", async () => {
    const root = resolve(
      process.cwd(),
      "src/app/(protected)/identity/[lang]"
    );
    const pages = (await pageFiles(root)).map((file) => relative(root, file));

    expect(pages.sort()).toEqual([...expectedMelodyPages].sort());
  });
});

async function pageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return pageFiles(path);
      return entry.isFile() && entry.name === "page.tsx" ? [path] : [];
    })
  );
  return files.flat();
}
