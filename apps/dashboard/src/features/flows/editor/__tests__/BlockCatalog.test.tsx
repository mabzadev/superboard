import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BlockCatalog } from "../BlockCatalog";
import { BLOCK_CATALOG } from "../graph";

describe("Flows block catalog", () => {
  it("renders every canonical block category and filters by behavior", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<BlockCatalog onAdd={onAdd} />);

    expect(screen.getByText("Logic")).toBeInTheDocument();
    expect(screen.getByText("Experience")).toBeInTheDocument();
    expect(screen.getByText("Utility")).toBeInTheDocument();
    for (const definition of BLOCK_CATALOG) {
      expect(
        screen.getByRole("button", {
          name: (name) =>
            name === `${definition.label} ${definition.description}`,
        })
      ).toBeInTheDocument();
    }

    await user.type(screen.getByPlaceholderText("Search blocks"), "survey");

    expect(screen.getByRole("button", { name: /^Survey/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Manual start/ })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Survey/ }));
    expect(onAdd).toHaveBeenCalledWith("survey");
  });

  it("publishes the stable drag payload consumed by the graph canvas", () => {
    const setData = vi.fn();
    render(<BlockCatalog onAdd={vi.fn()} />);

    fireEvent.dragStart(screen.getByRole("button", { name: /^Delay/ }), {
      dataTransfer: { setData },
    });

    expect(setData).toHaveBeenCalledWith(
      "application/superboard-flow-block",
      "delay"
    );
  });

  it("uses the API component definitions instead of generic SDK placeholders", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onAddComponent = vi.fn();
    const tooltip = {
      id: "tooltip-definition",
      library_id: "basics-library",
      library_name: "Basics V2",
      name: "Tooltip",
      key: "tooltip",
      component_type: "BasicsV2Tooltip",
      schema: {
        template_type: "component",
        description: "Guide a user from an anchored element.",
      },
      exit_nodes: ["continue", "close"],
      css_variables: {},
      current_version: 2,
    };
    render(
      <BlockCatalog
        components={[tooltip]}
        onAdd={onAdd}
        onAddComponent={onAddComponent}
      />
    );

    expect(screen.getByText("Components")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^ComponentRender/ })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Tooltip/ }));
    expect(onAddComponent).toHaveBeenCalledWith(tooltip);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
