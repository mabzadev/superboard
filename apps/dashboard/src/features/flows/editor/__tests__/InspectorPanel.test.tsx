import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InspectorPanel } from "../InspectorPanel";
import { createBlock } from "../graph";

describe("Flows inspector", () => {
  it("edits both workflow target and manual-start key", () => {
    const block = createBlock("workflow-trigger", { x: 0, y: 0 }, 1);
    const onChange = vi.fn();
    render(
      <InspectorPanel
        block={block}
        width={360}
        onResize={vi.fn()}
        onChange={onChange}
        onDelete={vi.fn()}
        locales={["en"]}
        translations={[]}
      />
    );

    fireEvent.change(screen.getByLabelText("Manual start block key"), {
      target: { value: "start-from-parent" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ blockKey: "start-from-parent" }),
      })
    );
  });

  it("adds a complete survey question without changing unrelated graph fields", async () => {
    const user = userEvent.setup();
    const block = createBlock("survey", { x: 120, y: 80 }, 1);
    const onChange = vi.fn();
    render(
      <InspectorPanel
        block={block}
        width={360}
        onResize={vi.fn()}
        onChange={onChange}
        onDelete={vi.fn()}
        locales={["en", "fr"]}
        translations={[]}
      />
    );

    expect(screen.getByText("Survey questions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: block.id,
        key: block.key,
        surveyQuestions: [
          expect.objectContaining({
            id: expect.any(String),
            type: "freeform",
            title: "New question",
            optional: false,
          }),
        ],
      })
    );
  });

  it("persists translated content on blur through the workflow contract", async () => {
    const user = userEvent.setup();
    const block = createBlock("component", { x: 0, y: 0 }, 1);
    block.data = { title: "Welcome", body: "Let’s begin" };
    const onTranslate = vi.fn().mockResolvedValue(undefined);
    render(
      <InspectorPanel
        block={block}
        width={360}
        onResize={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        locales={["fr"]}
        translations={[]}
        onTranslate={onTranslate}
      />
    );

    const titleTranslation = screen.getByPlaceholderText("Welcome");
    await user.type(titleTranslation, "Bienvenue");
    await user.tab();

    expect(onTranslate).toHaveBeenCalledWith(
      block.key,
      "title",
      "fr",
      "Bienvenue"
    );
    expect(
      await screen.findAllByText(/^(translated|traduite)$/i)
    ).not.toHaveLength(0);
  });

  it("edits connection labels and block-trigger semantics", async () => {
    const user = userEvent.setup();
    const onPathChange = vi.fn();
    const path = {
      id: "path-1",
      sourceBlockId: "source",
      sourceExitNode: "continue",
      targetBlockId: "target",
    };
    render(
      <InspectorPanel
        block={null}
        path={path}
        width={360}
        onResize={vi.fn()}
        onChange={vi.fn()}
        onPathChange={onPathChange}
        onDelete={vi.fn()}
        locales={["en"]}
        translations={[]}
      />
    );

    fireEvent.change(screen.getByLabelText("Connection label"), {
      target: { value: "qualified" },
    });
    expect(onPathChange).toHaveBeenLastCalledWith({
      ...path,
      label: "qualified",
    });
    await user.click(screen.getByRole("switch", { name: "Block trigger" }));
    expect(onPathChange).toHaveBeenLastCalledWith({
      ...path,
      triggerOnly: true,
    });
  });

  it("switches a block to an exact versioned Basics V2 definition", async () => {
    const user = userEvent.setup();
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      setPointerCapture: { configurable: true, value: () => undefined },
      releasePointerCapture: { configurable: true, value: () => undefined },
      scrollIntoView: { configurable: true, value: () => undefined },
    });
    const block = createBlock("component", { x: 0, y: 0 }, 1);
    const onChange = vi.fn();
    render(
      <InspectorPanel
        block={block}
        width={360}
        onResize={vi.fn()}
        onChange={onChange}
        onDelete={vi.fn()}
        locales={["en"]}
        translations={[]}
        components={[
          {
            id: "modal-definition",
            library_id: "basics-library",
            library_name: "Basics V2",
            name: "Modal",
            key: "modal",
            component_type: "BasicsV2Modal",
            current_version: 3,
            schema: {
              template_type: "component",
              slottable: false,
              properties: [{ key: "title", type: "string" }],
            },
            exit_nodes: ["continue", "close"],
            css_variables: {},
          },
        ]}
      />
    );

    await user.click(
      screen.getByRole("combobox", { name: /^Component definition/ })
    );
    await user.click(screen.getByRole("option", { name: "Modal · v3" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: block.id,
        componentType: "BasicsV2Modal",
        componentLibraryName: "Basics V2",
        exitNodes: ["continue", "close"],
        data: expect.objectContaining({
          componentKey: "modal",
          componentVersion: 3,
        }),
      })
    );
  });
});
