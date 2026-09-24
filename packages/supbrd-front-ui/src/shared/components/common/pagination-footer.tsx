import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";

import { useFrontContext } from "../../../context.js";
import { createFrontI18n } from "../../../i18n.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

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
	const { locale } = useFrontContext();
	const i18n = createFrontI18n({
		locale,
		messages: {
			en: {
				rows: "Rows",
				size: "Rows per page",
				page: "Page {page} of {total}",
				first: "First page",
				previous: "Previous page",
				next: "Next page",
				last: "Last page",
			},
			fr: {
				rows: "Lignes",
				size: "Lignes par page",
				page: "Page {page} sur {total}",
				first: "Première page",
				previous: "Page précédente",
				next: "Page suivante",
				last: "Dernière page",
			},
		},
	});

	const pageSizes = [10, 25, 50, 100];

	return (
		<div className="flex justify-between items-center px-4 py-3 text-sm w-full justify-between mt-auto">
			{/* Selected count */}

			{/* Pagination controls */}
			<div className="flex items-center gap-4  w-full justify-between">
				{/* Rows per page */}
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground">{i18n._("size")}</span>
					<Select
						value={String(rowsPerPage)}
						onValueChange={(v) => {
							setRowsPerPage(Number(v));
							setPage(1);
						}}
					>
						<SelectTrigger
							aria-label={i18n._("size")}
							className="w-[70px] border rounded px-2 py-1 text-sm"
						>
							<SelectValue placeholder={i18n._("rows")} />
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
				<span className="text-muted-foreground">{i18n._("page", { page, total: pageCount })}</span>

				{/* Pagination buttons */}
				<div className="flex gap-2">
					<button
						aria-label={i18n._("first")}
						onClick={() => setPage(1)}
						disabled={page - 1 === 0}
						className="px-2 py-1 border rounded disabled:opacity-30"
					>
						<ChevronFirst />
					</button>
					<button
						aria-label={i18n._("previous")}
						onClick={() => setPage(page - 1)}
						disabled={page - 1 === 0}
						className="px-2 py-1 border rounded disabled:opacity-30"
					>
						<ChevronLeft />
					</button>
					<button
						aria-label={i18n._("next")}
						onClick={() => setPage(page + 1)}
						disabled={page + 1 > pageCount}
						className="px-2 py-1 border rounded disabled:opacity-30"
					>
						<ChevronRight />
					</button>
					<button
						aria-label={i18n._("last")}
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
