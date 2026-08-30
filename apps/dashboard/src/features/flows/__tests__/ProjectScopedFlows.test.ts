import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DASHBOARD_SECTIONS } from "@/config/navigation";

const REMOVED_PRODUCT_LANGUAGE =
  /\b(?:organization|organisation|members?|invitations?|billing|facturation)\b/iu;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe("project-scoped Flows experience", () => {
  it("contains no removed product language in feature or client sources", () => {
    const files = [
      ...sourceFiles(join(process.cwd(), "src/features/flows")),
      join(process.cwd(), "src/api/flows/flowsService.ts"),
    ];

    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        REMOVED_PRODUCT_LANGUAGE
      );
    }
  });

  it("exposes only project-level Flows navigation", () => {
    const flows = DASHBOARD_SECTIONS.find(({ slug }) => slug === "flows");
    expect(JSON.stringify(flows)).not.toMatch(REMOVED_PRODUCT_LANGUAGE);
  });
});
