import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  ProjectSelectionProvider,
  useProjectSelection,
} from "@/context/useProjectSelection";

describe("Site project selection", () => {
  it("derives canonical production and test project references", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ProjectSelectionProvider instanceId="local">
        {children}
      </ProjectSelectionProvider>
    );
    const { result } = renderHook(() => useProjectSelection(), { wrapper });

    expect(result.current.selectedProject?.id).toBe("local-prod");
    expect(result.current.selectedInstance?.production.id).toBe("local-prod");
    expect(result.current.selectedInstance?.test.id).toBe("local-test");
  });
});
