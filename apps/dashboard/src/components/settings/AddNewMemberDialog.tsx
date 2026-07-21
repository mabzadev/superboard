import { useEffect, type ChangeEvent } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Check, ShieldUser, User, X } from "lucide-react";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../ui/select";
import { ADMIN_ROLE, MEMBER_ROLE } from "@/constants/OptionsConstants";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addMemberSchema, type AddMemberFormValues } from "@/schemas/member";

const AddNewMemberDialog = ({
  open,
  onOpenChange,
  handleInviteMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleInviteMember: (email: string, role: string) => void;
}) => {
  const form = useForm<AddMemberFormValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", role: MEMBER_ROLE },
    mode: "onChange",
  });

  const email = form.watch("email") ?? "";
  const role = form.watch("role");
  const isEmailFieldValid = !form.formState.errors.email && email.length > 0;

  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    form.setValue("email", event.target.value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  useEffect(() => {
    if (!open) {
      form.reset();
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="invite-member-description"
        showCloseButton={false}
        className="flex flex-col w-full max-w-[800px] max-h-[90vh] gap-4 my-6"
      >
        <DialogHeader>
          <div className="flex items-center gap-4 w-full">
            <DialogTitle className="font-semibold text-lg">
              Invite member
            </DialogTitle>
            <DialogClose className="ml-auto" aria-label="Close dialog">
              <X />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 w-full">
          {/* Members */}
          <div className="flex flex-col gap-4 max-w-[800px]">
            <span
              id="invite-member-description"
              className="text-sm text-muted-foreground"
            >
              You can add new members to your project, giving them access to
              specific areas based on their assigned role. They will receive an
              email to create an account once invited.
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4 w-full max-w-[600px]">
                <div className="flex w-full relative">
                  <Input
                    className={cn(
                      "pr-10 transition-all",
                      isEmailFieldValid
                        ? "border-valid-green ring-[2px] ring-valid-green/5"
                        : ""
                    )}
                    placeholder="Email address"
                    aria-label="Member email address"
                    name="email"
                    value={email}
                    onChange={handleEmailChange}
                    onBlur={() => form.trigger("email")}
                  />
                  {isEmailFieldValid && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                      <Check className="h-3 w-3 text-valid-green" />
                    </div>
                  )}
                </div>
                <Select
                  value={role}
                  onValueChange={(value) =>
                    form.setValue("role", value, { shouldValidate: true })
                  }
                >
                  <SelectTrigger
                    className="min-w-[160px] "
                    aria-label="Member role"
                  >
                    <div className="flex items-center gap-2 text-secondary-foreground">
                      {role === ADMIN_ROLE && (
                        <>
                          <ShieldUser className="w-4 h-4" />
                          <span>Administrator</span>
                        </>
                      )}
                      {role === MEMBER_ROLE && (
                        <>
                          <User className="w-4 h-4" />
                          <span>Member</span>
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
              </div>
            </div>

            <Button
              disabled={!form.formState.isValid}
              onClick={() => handleInviteMember(email, role)}
              className="w-full"
            >
              Add member
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddNewMemberDialog;
