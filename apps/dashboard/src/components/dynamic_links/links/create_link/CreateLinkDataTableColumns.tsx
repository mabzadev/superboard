import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";

type KeyValueRow = { key: string; value: string };

export const createAddNewLinkDataTableColumns = (
  remove?: (index: number) => void
): ColumnDef<KeyValueRow>[] => [
  {
    accessorKey: "key",
    header: () => (
      <div className="flex justify-start text-sm font-medium">Key</div>
    ),
    cell: ({ row }) => {
      return <div className="flex justify-start">{row.original.key}</div>;
    },
  },
  {
    accessorKey: "value",
    header: () => <div className="flex text-sm font-medium">Value</div>,

    cell: ({ row }) => {
      return (
        <div className="flex">
          <p>{row.original.value.toString()}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "actions",
    header: () => <div></div>,
    cell: ({ row }) => {
      return (
        remove && (
          <div className="flex justify-end">
            <Button
              variant={"ghost"}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
              onClick={() => remove && remove(row.index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      );
    },
  },
];
