"use client";
import { FULL_CHECK, NO_CHECK } from "@/constants/OptionsConstants";
import { Check } from "lucide-react";
import React from "react";

const CreateLinkSidebar = React.memo(function CreateLinkSidebar({
  sections,
  section,
  setSection,
}: {
  sections: {
    text: string;
    value: string;
    checked: string;
  }[];
  section: string;
  setSection: (value: string) => void;
}) {
  const renderCheckSign = (checkType: string) => {
    switch (checkType) {
      case FULL_CHECK:
        return (
          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
            <Check className="h-3 w-3 text-valid-green" />
          </div>
        );

      case NO_CHECK:
        return (
          <div className="flex items-center justify-center h-5 w-5 rounded-full border border-muted-foreground/30"></div>
        );
      default:
        return;
    }
  };

  return (
    <div className="w-full max-w-[250px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border px-2 pt-4">
      {sections.map((item) => {
        return (
          <div
            aria-selected={section === item.value}
            className="flex gap-4 justify-between px-3 py-2 items-center cursor-pointer rounded-md
            aria-selected:bg-sidebar-accent aria-selected:text-sidebar-accent-foreground
            hover:bg-sidebar-accent/50
            "
            onClick={() => setSection(item.value)}
            key={item.value}
          >
            <p className="text-sm">{item.text}</p>
            {renderCheckSign(item.checked)}
          </div>
        );
      })}
    </div>
  );
});

export default CreateLinkSidebar;
