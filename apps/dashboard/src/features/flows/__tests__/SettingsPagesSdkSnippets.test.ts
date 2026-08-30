import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  config: { apiUrl: "https://api.example.test///" },
}));

import { flowSdkSnippet, flowsSdkApiUrl } from "../SettingsPages";

describe("Flows SDK settings snippets", () => {
  it("normalizes the configured public API URL", () => {
    expect(flowsSdkApiUrl("  https://api.example.test///  ")).toBe(
      "https://api.example.test/api/v1/flows"
    );
  });

  it("renders the exact JavaScript initialization against the public API", () => {
    expect(flowSdkSnippet("javascript", "project-42", "production")).toBe(
      `import { init } from "@superboard/flows-js";\n\nconst flows = init({\n  apiUrl: "https://api.example.test/api/v1/flows",\n  projectId: "project-42",\n  environment: "production",\n  sdkKey: "YOUR_ENVIRONMENT_SDK_KEY",\n  userId: currentUser.id,\n});`
    );
  });

  it("renders the exact React provider against the public API", () => {
    expect(flowSdkSnippet("react", "project-42", "production")).toBe(
      `import { FlowsProvider } from "@superboard/flows-react";\n\n<FlowsProvider\n  apiUrl="https://api.example.test/api/v1/flows"\n  projectId="project-42"\n  environment="production"\n  sdkKey="YOUR_ENVIRONMENT_SDK_KEY"\n  userId={user.id}\n>\n  <App />\n</FlowsProvider>`
    );
  });

  it("renders the exact Flutter initialization with its required apiUrl", () => {
    expect(flowSdkSnippet("flutter", "project-42", "production")).toBe(
      `await SuperBoardFlows.initialize(\n  apiUrl: 'https://api.example.test/api/v1/flows',\n  projectId: 'project-42',\n  environment: 'production',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUser.id,\n);\n\nreturn SuperBoardFlowsOverlay(child: app);`
    );
  });

  it("uses the exact exported FlutterFlow action and required apiUrl", () => {
    expect(flowSdkSnippet("flutterflow", "project-42", "production")).toBe(
      `await superboardFlowsInitialize(\n  apiUrl: 'https://api.example.test/api/v1/flows',\n  projectId: 'project-42',\n  environment: 'production',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUserId,\n);`
    );
  });
});
