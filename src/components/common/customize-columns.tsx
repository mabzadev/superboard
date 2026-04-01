"use client";
import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Columns2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export interface ColumnOptionType {
  label: string;
  value: string;
}

const CustomizeColumns = ({
  columnOptions,
  selectedColumns,
  setSelectedColumns,
}: {
  columnOptions: ColumnOptionType[];
  selectedColumns: string[];
  setSelectedColumns: React.Dispatch<React.SetStateAction<string[]>>;
}) => {
  const toggleValue = (value: string) => {
    setSelectedColumns((prev: string[]) =>
      prev.includes(value)
        ? prev.filter((v: string) => v !== value)
        : [...prev, value]
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="shadow-none">
          <Columns2 className="size-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2 space-y-2">
        {columnOptions.map((option: ColumnOptionType) => (
          <label
            key={option.value}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <Checkbox
              checked={selectedColumns.includes(option.value)}
              onCheckedChange={() => toggleValue(option.value)}
              id={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export default CustomizeColumns;
