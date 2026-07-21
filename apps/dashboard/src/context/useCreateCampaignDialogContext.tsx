import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@radix-ui/react-dialog";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useRedirectConfigQuery } from "@/hooks/queries/useConfigurationQueries";
import { useProjectSelection } from "@/context/useProjectSelection";
import RedirectRulesGateDialog from "@/components/common/redirect-rules-gate-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCampaignSchema,
  type CreateCampaignFormValues,
} from "@/schemas/project";

type DialogOptions = {
  onConfirm?: (...args: unknown[]) => Promise<void> | void;
};

type CreateCampaignDialogContextType = {
  openDialog: (options: DialogOptions) => void;
};

const CreateCampaignDialogContext = createContext<
  CreateCampaignDialogContextType | undefined
>(undefined);

const CreateCampaignGlobalDialogProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { selectedProject } = useProjectSelection();
  const redirectConfigQuery = useRedirectConfigQuery(selectedProject?.id);
  const projectRedirectsConfig = redirectConfigQuery.data;
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<DialogOptions>({});
  const [redirectGateOpen, setRedirectGateOpen] = useState(false);

  const form = useForm<CreateCampaignFormValues>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const openDialog = useCallback(
    (opts: DialogOptions) => {
      if (!projectRedirectsConfig?.default_fallback) {
        setRedirectGateOpen(true);
        return;
      }
      setOptions(opts);
      setIsOpen(true);
    },
    [projectRedirectsConfig?.default_fallback]
  );

  const handleClose = () => {
    setIsOpen(false);
    form.reset();
  };

  const onSubmit = async (data: CreateCampaignFormValues) => {
    await options.onConfirm?.(data.name);
    handleClose();
  };

  return (
    <CreateCampaignDialogContext.Provider
      value={useMemo(() => ({ openDialog }), [openDialog])}
    >
      {children}
      <RedirectRulesGateDialog
        open={redirectGateOpen}
        onOpenChange={setRedirectGateOpen}
      />
      <Dialog open={isOpen} onOpenChange={handleClose} modal>
        <DialogContent className="p-0 gap-0 sm:max-w-[480px] border-sidebar-border">
          <DialogHeader className="px-6 pt-5 pb-4">
            <DialogTitle className="text-base font-semibold">
              Create Campaign
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Organize links under a unified marketing objective.
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex flex-col px-6 py-5 gap-2">
              <label className="text-sm font-medium">Campaign name</label>
              <Input
                autoFocus
                placeholder="e.g. Summer Sale 2026"
                {...form.register("name")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && form.formState.isValid) {
                    e.preventDefault();
                    form.handleSubmit(onSubmit)();
                  }
                }}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-end px-6 py-3">
              <Button type="submit" disabled={!form.formState.isValid}>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </CreateCampaignDialogContext.Provider>
  );
};

export const useGlobalDialog = () => {
  const context = useContext(CreateCampaignDialogContext);
  if (!context)
    throw new Error("useGlobalDialog must be used within DialogProvider");
  return context;
};

export default CreateCampaignGlobalDialogProvider;
