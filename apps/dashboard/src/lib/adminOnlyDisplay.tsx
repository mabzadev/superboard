"use client";
import { ADMIN_ROLE } from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useUserContext } from "@/context/useUserContext";

import React from "react";

const AdminOnlyDisplay = ({ children }: { children: React.ReactNode }) => {
  const { userRef } = useUserContext();
  const { selectedInstance } = useProjectSelection();

  const roles = userRef.current?.roles || [];
  const currentInstanceId = selectedInstance?.id;
  const roleEntry = roles.find((r) => r.instance_id === currentInstanceId);

  if (roleEntry?.role !== ADMIN_ROLE) {
    return;
  }

  return <>{children}</>;
};

export default AdminOnlyDisplay;
