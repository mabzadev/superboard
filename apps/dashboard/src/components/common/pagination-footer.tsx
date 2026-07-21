import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PaginationFooter = ({
  totalRows: _totalRows,
  selectedCount: _selectedCount,
  page,
  pageCount,
  rowsPerPage,
  setRowsPerPage,
  setPage,
}: {
  totalRows?: number;
  selectedCount?: number;
  page: number;
  pageCount: number;
  rowsPerPage: number;
  setRowsPerPage: (value: number) => void;
  setPage: (value: number) => void;
}) => {
  const pageSizes = [10, 25, 50, 100];

  return (
    <div className="flex justify-between items-center px-4 py-3 text-sm w-full justify-between mt-auto">
      {/* Selected count */}

      {/* Pagination controls */}
      <div className="flex items-center gap-4  w-full justify-between">
        {/* Rows per page */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Rows per page</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => {
              setRowsPerPage(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[70px] border rounded px-2 py-1 text-sm">
              <SelectValue placeholder="Rows" />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page info */}
        <span className="text-muted-foreground">
          Page {page} of {pageCount}
        </span>

        {/* Pagination buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setPage(1)}
            disabled={page - 1 === 0}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            <ChevronFirst />
          </button>
          <button
            onClick={() => setPage(page - 1)}
            disabled={page - 1 === 0}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            <ChevronLeft />
          </button>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page + 1 > pageCount}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            <ChevronRight />
          </button>
          <button
            onClick={() => setPage(pageCount)}
            disabled={page + 1 > pageCount}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            <ChevronLast />
          </button>
        </div>
      </div>
    </div>
  );
};
