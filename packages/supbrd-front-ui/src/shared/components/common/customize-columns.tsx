"use client";
import { Columns2 } from "lucide-react";
import React from "react";

import { useFrontContext } from "../../../context.js";
import { createFrontI18n } from "../../../i18n.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";

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
	const { locale } = useFrontContext();
	const i18n = createFrontI18n({
		locale,
		messages: { en: { columns: "Columns" }, fr: { columns: "Colonnes" } },
	});
	const toggleValue = (value: string) => {
		setSelectedColumns((prev: string[]) =>
			prev.includes(value) ? prev.filter((v: string) => v !== value) : [...prev, value],
		);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-label={i18n._("columns")}
					className="shadow-none"
				>
					<Columns2 className="size-4" />
					{i18n._("columns")}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[200px] p-2 space-y-2">
				{columnOptions.map((option: ColumnOptionType) => (
					<label key={option.value} className="flex items-center gap-2 text-sm cursor-pointer">
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
