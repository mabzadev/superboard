"use client";

import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  Check,
  FolderPlus,
  ShieldUser,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { ADMIN_ROLE, MEMBER_ROLE } from "@/constants/OptionsConstants";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../ui/select";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createProjectSchema,
  type CreateProjectFormValues,
} from "@/schemas/project";

type ProjectFormDialogProps = {
  variant: "first-project" | "new-project";
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  handleCreateProject: (
    projectName: string,
    members: { email: string; role: string }[]
  ) => void;
};

const ProjectFormDialog = ({
  variant,
  open,
  onOpenChange,
  handleCreateProject,
}: ProjectFormDialogProps) => {
  const { resolvedTheme } = useTheme();

  const form = useForm<CreateProjectFormValues>({
    resolver: zodResolver(
      createProjectSchema
    ) as Resolver<CreateProjectFormValues>,
    defaultValues: { name: "", members: [] },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "members",
  });

  const projectName = form.watch("name");

  const handleAddMember = () => {
    append({ email: "", role: MEMBER_ROLE });
  };

  const onSubmit = (data: CreateProjectFormValues) => {
    handleCreateProject(data.name, data.members);
  };

  useEffect(() => {
    if (!open) {
      form.reset();
    }
  }, [open, form]);

  const isFirstProject = variant === "first-project";

  return (
    <>
      {isFirstProject && (
        <div className="absolute z-11 w-full h-full bg-primary-foreground" />
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby="project-dialog-description"
          showCloseButton={false}
          className="flex flex-col w-full max-w-[520px] max-h-[85vh] gap-0 p-0 overflow-hidden rounded-xl"
        >
          <DialogTitle className="sr-only">Create Project</DialogTitle>
          {/* Gradient Hero Header */}
          <div
            className={cn(
              "px-6 pt-10 pb-8 flex flex-col items-center text-center",
              !isFirstProject && "relative"
            )}
            style={{
              background:
                resolvedTheme === "dark"
                  ? "linear-gradient(180deg, rgba(60, 90, 140, 0.15) 0%, rgba(140, 100, 70, 0.10) 100%)"
                  : "linear-gradient(180deg, rgba(190, 218, 252, 0.25) 0%, rgba(255, 233, 216, 0.25) 100%)",
            }}
          >
            {!isFirstProject && (
              <button
                onClick={() => onOpenChange?.(false)}
                aria-label="Close dialog"
                className="absolute top-4 right-4 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-foreground mb-4">
              <FolderPlus className="h-5 w-5 text-background" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight mb-1">
              {isFirstProject ? "Welcome to OpenGrow" : "Create Project"}
            </h2>
            <p
              id="project-dialog-description"
              className="text-sm text-muted-foreground leading-relaxed"
            >
              {isFirstProject
                ? "Create your first project to get started."
                : "Set up your new project and invite your team."}
            </p>
          </div>

          {/* Form Section */}
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex flex-col gap-4 px-6 pb-6 pt-5 overflow-y-auto">
              {/* Project Name */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="project-name-input"
                  className="text-sm font-medium"
                >
                  Project Name
                </label>
                <div className="relative">
                  <Input
                    id="project-name-input"
                    className={cn(
                      "pr-10 rounded-lg transition-all",
                      projectName.length > 2
                        ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                        : ""
                    )}
                    placeholder="Enter project name"
                    maxLength={50}
                    {...form.register("name")}
                  />
                  {projectName.length > 2 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                      <Check className="h-3 w-3 text-valid-green" />
                    </div>
                  )}
                </div>
              </div>

              {/* Members */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">
                      Invite members
                    </label>
                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                      Optional
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Invitees will receive an email. Existing users are added
                    automatically.
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {fields.map((field, index) => {
                    const memberEmail = form.watch(`members.${index}.email`);
                    const memberRole = form.watch(`members.${index}.role`);
                    const memberError =
                      form.formState.errors.members?.[index]?.email;
                    const isMemberEmailValid =
                      !memberError && memberEmail.length > 0;

                    return (
                      <div key={field.id} className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <Input
                            className={cn(
                              "h-9 rounded-lg pr-9 transition-all",
                              isMemberEmailValid
                                ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                                : ""
                            )}
                            placeholder="name@company.com"
                            aria-label={`Email for member ${index + 1}`}
                            {...form.register(`members.${index}.email`)}
                          />
                          {isMemberEmailValid && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                              <Check className="h-3 w-3 text-valid-green" />
                            </div>
                          )}
                        </div>
                        <Select
                          value={memberRole}
                          onValueChange={(value) =>
                            form.setValue(`members.${index}.role`, value, {
                              shouldValidate: true,
                            })
                          }
                        >
                          <SelectTrigger
                            className="w-[130px] h-9 rounded-lg"
                            aria-label={`Role for member ${index + 1}`}
                          >
                            <div className="flex items-center gap-1.5 text-secondary-foreground">
                              {memberRole === ADMIN_ROLE && (
                                <>
                                  <ShieldUser className="w-3.5 h-3.5" />
                                  <span className="text-sm">Admin</span>
                                </>
                              )}
                              {memberRole === MEMBER_ROLE && (
                                <>
                                  <User className="w-3.5 h-3.5" />
                                  <span className="text-sm">Member</span>
                                </>
                              )}
                            </div>
                          </SelectTrigger>
                          <SelectContent className="bg-secondary border-none">
                            <SelectGroup>
                              <SelectLabel>Role</SelectLabel>
                              <SelectItem value={ADMIN_ROLE}>
                                <ShieldUser className="w-4 h-4 mr-2" />
                                Administrator
                              </SelectItem>
                              <SelectItem value={MEMBER_ROLE}>
                                <User className="w-4 h-4 mr-2" />
                                Member
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove member"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddMember}
                    className="w-full h-9 rounded-lg text-sm gap-2 border-dashed"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add team member
                  </Button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={!form.formState.isValid}
                className="w-full rounded-lg"
                variant="default"
              >
                Create project
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectFormDialog;
