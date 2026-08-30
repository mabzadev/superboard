import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/hooks/queries/useConfigurationQueries", () => ({
  useRedirectConfigQuery: () => ({ data: null }),
}));
vi.mock("@/hooks/queries/useLinksQueries", () => ({
  useRandomPathQuery: () => ({ data: undefined }),
  usePathAvailableQuery: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/useLinksMutations", () => ({
  useCreateLinkMutation: () => ({ isPending: false }),
  useUpdateLinkMutation: () => ({ isPending: false }),
  useRemoveLinkMutation: () => ({ isPending: false }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SuperBoardFrontProviders } from "../../../../site/src/components/SuperBoardFrontProviders";
import { useProjectSelection } from "@/context/useProjectSelection";

function ProjectProbe() {
  const { selectedInstance, selectedProject } = useProjectSelection();
  return <div>{`${selectedInstance?.id}:${selectedProject?.id}`}</div>;
}

describe("LinkDialogProvider in the Site host", () => {
  test("uses the host-overridable project selection boundary", () => {
    render(
      <SuperBoardFrontProviders
        instanceId="mbza-development"
        productionProjectRef="1-prod"
        testProjectRef="1-test"
      >
        <div>mounted</div>
        <ProjectProbe />
      </SuperBoardFrontProviders>
    );

    expect(screen.getByText("mounted")).toBeInTheDocument();
    expect(screen.getByText("1:1-prod")).toBeInTheDocument();
  });
});
