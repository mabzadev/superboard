"use client";

import { useEffect, useState } from "react";
import { Bot, Play, Plus, ShieldCheck } from "lucide-react";
import {
  createSupportAssistantTask,
  getSupportAssistantTask,
  listSupportAssistantTasks,
  supportAssistantScenarios,
  supportAssistantTools,
  supportAssistants,
  type SupportAssistantTask,
} from "@/api/support/captainService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  SupportEmpty,
  SupportError,
  SupportLoading,
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

export default function SupportCaptainPage() {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const assistants = useSupportCollection(projectRef, supportAssistants.list);
  const scenarios = useSupportCollection(
    projectRef,
    supportAssistantScenarios.list
  );
  const tools = useSupportCollection(projectRef, supportAssistantTools.list);
  const [saving, setSaving] = useState(false);
  const [assistant, setAssistant] = useState({
    name: "",
    description: "",
    instructions: "",
    mode: "suggestion",
    handoff: true,
  });
  const [scenario, setScenario] = useState({
    assistantId: "",
    name: "",
    instructions: "",
  });
  const [tool, setTool] = useState({
    assistantId: "",
    name: "",
    description: "",
    endpoint: "",
    method: "POST",
    allowed: false,
  });
  const [task, setTask] = useState({
    assistantId: "",
    conversationId: "",
    type: "summarize",
    toolId: "",
    argumentsJson: "{}",
  });
  const [tasks, setTasks] = useState<SupportAssistantTask[]>([]);

  useEffect(() => {
    if (!projectRef) return;
    void listSupportAssistantTasks(projectRef, { limit: 20 })
      .then((result) => setTasks(result.data))
      .catch((cause) => showErrorNotification(moduleErrorMessage(cause)));
  }, [projectRef]);

  useEffect(() => {
    if (!projectRef || !tasks.some((item) => item.status === "queued" || item.status === "running")) return;
    const timer = window.setInterval(() => {
      void Promise.all(
        tasks
          .filter((item) => item.status === "queued" || item.status === "running")
          .map((item) => getSupportAssistantTask(projectRef, item.id))
      ).then((results) => {
        const updates = new Map(results.map((result) => [result.data.id, result.data]));
        setTasks((current) => current.map((item) => updates.get(item.id) ?? item));
      }).catch((cause) => showErrorNotification(moduleErrorMessage(cause)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [projectRef, tasks]);

  const createAssistant = async () => {
    if (!projectRef || !assistant.name.trim() || !assistant.instructions.trim())
      return;
    setSaving(true);
    try {
      await supportAssistants.create(projectRef, {
        name: assistant.name.trim(),
        description: assistant.description.trim() || null,
        instructions: assistant.instructions.trim(),
        response_mode: assistant.mode,
        handoff_enabled: assistant.handoff,
        active: true,
      });
      setAssistant((current) => ({
        ...current,
        name: "",
        description: "",
        instructions: "",
        mode: "suggestion",
      }));
      await assistants.reload();
      showSuccessNotification("Support assistant created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const createScenario = async () => {
    if (
      !projectRef ||
      !scenario.assistantId ||
      !scenario.name.trim() ||
      !scenario.instructions.trim()
    )
      return;
    setSaving(true);
    try {
      await supportAssistantScenarios.create(projectRef, {
        assistant_id: scenario.assistantId,
        name: scenario.name.trim(),
        trigger: {},
        instructions: scenario.instructions.trim(),
        position: 0,
        active: true,
      });
      setScenario((current) => ({ ...current, name: "", instructions: "" }));
      await scenarios.reload();
      showSuccessNotification("Assistant scenario created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const createTool = async () => {
    if (
      !projectRef ||
      !tool.assistantId ||
      !tool.name.trim() ||
      !tool.description.trim() ||
      !tool.endpoint.trim()
    )
      return;
    setSaving(true);
    try {
      await supportAssistantTools.create(projectRef, {
        assistant_id: tool.assistantId,
        name: tool.name.trim(),
        description: tool.description.trim(),
        endpoint_url: tool.endpoint.trim(),
        method: tool.method,
        input_schema: { type: "object", properties: {} },
        headers: {},
        allowed: tool.allowed,
      });
      setTool((current) => ({
        ...current,
        name: "",
        description: "",
        endpoint: "",
        allowed: false,
      }));
      await tools.reload();
      showSuccessNotification("Assistant tool created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const queueTask = async () => {
    if (!projectRef || !task.assistantId) return;
    if (task.type === "handoff" && !task.conversationId.trim()) {
      showErrorNotification("Human handoff requires a conversation ID");
      return;
    }
    let input: Record<string, unknown> = {};
    if (task.type === "run_tool") {
      if (!task.toolId) {
        showErrorNotification("Select an allowlisted tool");
        return;
      }
      try {
        const argumentsValue: unknown = JSON.parse(task.argumentsJson);
        if (
          !argumentsValue ||
          typeof argumentsValue !== "object" ||
          Array.isArray(argumentsValue)
        ) {
          throw new Error("invalid");
        }
        input = { tool_id: task.toolId, arguments: argumentsValue };
      } catch {
        showErrorNotification("Tool arguments must be a JSON object");
        return;
      }
    }
    setSaving(true);
    try {
      const result = await createSupportAssistantTask(projectRef, {
        task_type: task.type as
          | "suggest_reply"
          | "summarize"
          | "translate"
          | "index_document"
          | "copilot"
          | "handoff"
          | "run_tool",
        assistant_id: task.assistantId,
        conversation_id: task.conversationId.trim() || undefined,
        input,
      });
      const created = await getSupportAssistantTask(projectRef, result.data.id);
      setTasks((current) => [created.data, ...current.filter((item) => item.id !== created.data.id)]);
      showSuccessNotification(`Task ${result.data.id} queued`);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModulePage
      title="Captain"
      description="Project-isolated assistants, Copilot scenarios, allowlisted tools and traceable tasks."
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="assistants">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="assistants">Assistants</TabsTrigger>
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-4" value="assistants">
            <Toolbar collection={assistants} />
            <SupportError message={assistants.error} />
            {assistant.mode === "automatic" ? (
              <Alert>
                <ShieldCheck />
                <AlertTitle>Explicit automatic mode</AlertTitle>
                <AlertDescription>
                  Automatic sending is enabled only for this assistant. Human
                  handoff remains available.
                </AlertDescription>
              </Alert>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot /> New assistant
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={assistant.name}
                    onChange={(e) =>
                      setAssistant((v) => ({ ...v, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Description">
                  <Input
                    value={assistant.description}
                    onChange={(e) =>
                      setAssistant((v) => ({
                        ...v,
                        description: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Response mode">
                  <Select
                    value={assistant.mode}
                    onChange={(mode) => setAssistant((v) => ({ ...v, mode }))}
                    options={["suggestion", "draft", "automatic"]}
                  />
                </Field>
                <div className="flex items-center gap-3 pt-7">
                  <Switch
                    checked={assistant.handoff}
                    onCheckedChange={(handoff) =>
                      setAssistant((v) => ({ ...v, handoff }))
                    }
                  />
                  <Label>Human handoff</Label>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Instructions</Label>
                  <Textarea
                    rows={7}
                    value={assistant.instructions}
                    onChange={(e) =>
                      setAssistant((v) => ({
                        ...v,
                        instructions: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex justify-end md:col-span-2">
                  <Button
                    disabled={saving}
                    onClick={() => void createAssistant()}
                  >
                    <Plus /> Create assistant
                  </Button>
                </div>
              </CardContent>
            </Card>
            <ResourceList
              loading={assistants.loading}
              empty="No Support assistants"
              items={assistants.items.map((item) => ({
                id: item.id,
                title: item.name,
                detail: `${item.response_mode} · ${item.handoff_enabled ? "human handoff" : "no handoff"}`,
                status: item.active ? "active" : "disabled",
              }))}
            />
          </TabsContent>
          <TabsContent className="space-y-4" value="scenarios">
            <Toolbar collection={scenarios} />
            <SupportError message={scenarios.error} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New scenario</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Assistant">
                  <AssistantSelect
                    value={scenario.assistantId}
                    onChange={(assistantId) =>
                      setScenario((v) => ({ ...v, assistantId }))
                    }
                    items={assistants.items}
                  />
                </Field>
                <Field label="Scenario name">
                  <Input
                    value={scenario.name}
                    onChange={(e) =>
                      setScenario((v) => ({ ...v, name: e.target.value }))
                    }
                  />
                </Field>
                <div className="space-y-2 md:col-span-2">
                  <Label>Scenario instructions</Label>
                  <Textarea
                    rows={6}
                    value={scenario.instructions}
                    onChange={(e) =>
                      setScenario((v) => ({
                        ...v,
                        instructions: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex justify-end md:col-span-2">
                  <Button
                    disabled={saving}
                    onClick={() => void createScenario()}
                  >
                    <Plus /> Create scenario
                  </Button>
                </div>
              </CardContent>
            </Card>
            <ResourceList
              loading={scenarios.loading}
              empty="No assistant scenarios"
              items={scenarios.items.map((item) => ({
                id: item.id,
                title: item.name,
                detail: `Assistant ${item.assistant_id}`,
                status: item.active ? "active" : "disabled",
              }))}
            />
          </TabsContent>
          <TabsContent className="space-y-4" value="tools">
            <Toolbar collection={tools} />
            <SupportError message={tools.error} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  New allowlisted tool
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Assistant">
                  <AssistantSelect
                    value={tool.assistantId}
                    onChange={(assistantId) =>
                      setTool((v) => ({ ...v, assistantId }))
                    }
                    items={assistants.items}
                  />
                </Field>
                <Field label="Name">
                  <Input
                    value={tool.name}
                    onChange={(e) =>
                      setTool((v) => ({ ...v, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Method">
                  <Select
                    value={tool.method}
                    onChange={(method) => setTool((v) => ({ ...v, method }))}
                    options={["GET", "POST"]}
                  />
                </Field>
                <Field label="Endpoint">
                  <Input
                    type="url"
                    value={tool.endpoint}
                    onChange={(e) =>
                      setTool((v) => ({ ...v, endpoint: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Description">
                  <Input
                    value={tool.description}
                    onChange={(e) =>
                      setTool((v) => ({ ...v, description: e.target.value }))
                    }
                  />
                </Field>
                <div className="flex items-center gap-3 pt-7">
                  <Switch
                    checked={tool.allowed}
                    onCheckedChange={(allowed) =>
                      setTool((v) => ({ ...v, allowed }))
                    }
                  />
                  <Label>Allow execution</Label>
                </div>
                <div className="flex justify-end md:col-span-2 xl:col-span-4">
                  <Button disabled={saving} onClick={() => void createTool()}>
                    <Plus /> Add tool
                  </Button>
                </div>
              </CardContent>
            </Card>
            <ResourceList
              loading={tools.loading}
              empty="No assistant tools"
              items={tools.items.map((item) => ({
                id: item.id,
                title: item.name,
                detail: `${item.method} ${item.endpoint_url}`,
                status: item.allowed ? "active" : "disabled",
              }))}
            />
          </TabsContent>
          <TabsContent className="space-y-4" value="tasks">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play /> Run an assistant task
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Assistant">
                  <AssistantSelect
                    value={task.assistantId}
                    onChange={(assistantId) =>
                      setTask((v) => ({ ...v, assistantId }))
                    }
                    items={assistants.items}
                  />
                </Field>
                <Field label="Task">
                  <Select
                    value={task.type}
                    onChange={(type) => setTask((v) => ({ ...v, type }))}
                    options={[
                      "suggest_reply",
                      "summarize",
                      "translate",
                      "index_document",
                      "copilot",
                      "handoff",
                      "run_tool",
                    ]}
                  />
                </Field>
                <Field label="Conversation ID (optional)">
                  <Input
                    value={task.conversationId}
                    onChange={(e) =>
                      setTask((v) => ({ ...v, conversationId: e.target.value }))
                    }
                  />
                </Field>
                {task.type === "run_tool" ? (
                  <>
                    <Field label="Allowlisted tool">
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={task.toolId}
                        onChange={(event) =>
                          setTask((value) => ({
                            ...value,
                            toolId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select tool</option>
                        {tools.items
                          .filter(
                            (item) =>
                              item.allowed &&
                              item.assistant_id === task.assistantId
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="space-y-2 md:col-span-2 xl:col-span-4">
                      <Label>Tool arguments (JSON object)</Label>
                      <Textarea
                        rows={5}
                        spellCheck={false}
                        value={task.argumentsJson}
                        onChange={(event) =>
                          setTask((value) => ({
                            ...value,
                            argumentsJson: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </>
                ) : null}
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={saving}
                    onClick={() => void queueTask()}
                  >
                    <Play /> Queue task
                  </Button>
                </div>
              </CardContent>
            </Card>
            {tasks.length === 0 ? (
              <SupportEmpty
                title="No assistant tasks"
                description="Run a task to receive a project-isolated result with traceable sources."
              />
            ) : (
              <div className="space-y-3">
                {tasks.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <strong>{item.task_type}</strong>
                        <SupportStatus value={item.status} />
                      </div>
                      {item.result?.text ? <p className="whitespace-pre-wrap text-sm">{item.result.text}</p> : null}
                      {item.result?.handoff ? <p className="text-sm">Transferred to a human agent.</p> : null}
                      {item.result?.tool_id ? (
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                          {JSON.stringify(item.result.output, null, 2)}
                        </pre>
                      ) : null}
                      {(item.result?.sources ?? []).length ? (
                        <div className="text-xs text-muted-foreground">
                          Sources: {(item.result.sources ?? []).map((source) => source.title).join(" · ")}
                        </div>
                      ) : null}
                      {item.error_code ? <div className="text-sm text-destructive">Task failed: {item.error_code}</div> : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

type Named = { id: string; name: string };
function AssistantSelect({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Named[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select assistant</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
function Toolbar({
  collection,
}: {
  collection: ReturnType<typeof useSupportCollection<Named>>;
}) {
  return (
    <SupportSearchToolbar
      query={collection.query}
      setQuery={collection.setQuery}
      onSearch={collection.search}
      onRefresh={collection.reload}
      loading={collection.loading}
    />
  );
}
function ResourceList({
  loading,
  items,
  empty,
}: {
  loading: boolean;
  items: Array<{ id: string; title: string; detail: string; status: string }>;
  empty: string;
}) {
  if (loading) return <SupportLoading />;
  if (!items.length)
    return (
      <SupportEmpty
        title={empty}
        description="Create one with the form above."
      />
    );
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
            <SupportStatus value={item.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm capitalize"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
