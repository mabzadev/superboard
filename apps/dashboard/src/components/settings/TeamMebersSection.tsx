"use client";
import { Plus } from "lucide-react";
import React from "react";
import { Button } from "../ui/button";
import MemberSectionElement from "./MemberSectionElement";
import AddNewMemberDialog from "./AddNewMemberDialog";
import type { InstanceMember } from "@/types";

const TeamMebersSection = ({
  members,
  handleRemoveMember,
  handleInviteMember,
  inviteDialogOpen,
  setInviteDialogOpen,
}: {
  members: InstanceMember[];
  setMembers: React.Dispatch<React.SetStateAction<InstanceMember[]>>;
  handleRemoveMember: (emai: string) => void;
  handleInviteMember: (emai: string, role: string) => void;
  inviteDialogOpen: boolean;
  setInviteDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  return (
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-0.5 flex-1">
          <span className="text-sm font-semibold">Team Members</span>
          <span className="text-xs text-muted-foreground">
            Manage who has access to this project.
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setInviteDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add member
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-sidebar-border overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_140px_40px] items-center px-4 py-2.5 bg-muted/40 border-b border-sidebar-border">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Member
          </span>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
            Role
          </span>
          <span />
        </div>
        {/* Table rows */}
        <div className="divide-y divide-sidebar-border">
          {members.map((member) => (
            <MemberSectionElement
              key={member.id}
              member={member}
              onRemove={handleRemoveMember}
            />
          ))}
        </div>
      </div>

      <AddNewMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        handleInviteMember={handleInviteMember}
      />
    </div>
  );
};

export default TeamMebersSection;
