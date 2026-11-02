import { Button, Loader, Toast } from "@cloudflare/kumo";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, IdentificationCard, Pencil, Plus, Trash } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { BylineFieldEditor } from "../components/BylineFieldEditor.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
	createBylineField,
	deleteBylineField,
	getBylineFieldUsage,
	listBylineFields,
	reorderBylineFields,
	updateBylineField,
	type BylineFieldDefinition,
	type CreateBylineFieldInput,
	type UpdateBylineFieldInput,
} from "../lib/api/byline-fields.js";
import { useCurrentUser } from "../lib/api/current-user.js";

const ROLE_ADMIN = 50;

const QUERY_KEY = ["byline-fields"] as const;

export function BylineSchemaPage() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const toastManager = Toast.useToastManager();
	const { data: currentUser, isLoading: userLoading } = useCurrentUser();

	const [editingField, setEditingField] = React.useState<BylineFieldDefinition | null>(null);
	const [creating, setCreating] = React.useState(false);
	const [deletingField, setDeletingField] = React.useState<BylineFieldDefinition | null>(null);

	const fieldsQuery = useQuery({
		queryKey: QUERY_KEY,
		queryFn: listBylineFields,
		enabled: !!currentUser && currentUser.role >= ROLE_ADMIN,
	});

	const usageQuery = useQuery({
		queryKey: ["byline-schema", "usage", editingField?.slug ?? null],
		queryFn: () => (editingField ? getBylineFieldUsage(editingField.slug) : Promise.resolve(null)),
		enabled: !!editingField,
	});

	const deleteUsageQuery = useQuery({
		queryKey: ["byline-schema", "usage", deletingField?.slug ?? null],
		queryFn: () =>
			deletingField ? getBylineFieldUsage(deletingField.slug) : Promise.resolve(null),
		enabled: !!deletingField,
	});

	const createMutation = useMutation({
		mutationFn: (input: CreateBylineFieldInput) => createBylineField(input),
		onSuccess: (field) => {
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			toastManager.add({
				title: t`Field created`,
				description: t`Created "${field.label}".`,
			});
			setCreating(false);
		},
		onError: (mutationError) => {
			toastManager.add({
				title: t`Failed to create field`,
				description: mutationError instanceof Error ? mutationError.message : t`An error occurred`,
				type: "error",
			});
		},
	});

	const updateMutation = useMutation({
		mutationFn: (vars: { slug: string; input: UpdateBylineFieldInput }) =>
			updateBylineField(vars.slug, vars.input),
		onSuccess: (field) => {
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			toastManager.add({
				title: t`Field updated`,
				description: t`Saved "${field.label}".`,
			});
			setEditingField(null);
		},
		onError: (mutationError) => {
			toastManager.add({
				title: t`Failed to save field`,
				description: mutationError instanceof Error ? mutationError.message : t`An error occurred`,
				type: "error",
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (slug: string) => deleteBylineField(slug),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			toastManager.add({ title: t`Field deleted` });
			setDeletingField(null);
		},
		onError: (mutationError) => {
			toastManager.add({
				title: t`Failed to delete field`,
				description: mutationError instanceof Error ? mutationError.message : t`An error occurred`,
				type: "error",
			});
		},
	});

	const reorderMutation = useMutation({
		mutationFn: (slugs: string[]) => reorderBylineFields(slugs),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
		},
		onError: (mutationError) => {
			toastManager.add({
				title: t`Failed to reorder fields`,
				description: mutationError instanceof Error ? mutationError.message : t`An error occurred`,
				type: "error",
			});
		},
	});

	if (userLoading) {
		return (
			<div className="flex items-center justify-center min-h-[50vh]">
				<Loader />
			</div>
		);
	}

	if (!currentUser || currentUser.role < ROLE_ADMIN) {
		return (
			<div className="flex items-center justify-center min-h-[50vh]">
				<div className="text-center">
					<h1 className="text-2xl font-semibold leading-tight">{t`Access denied`}</h1>
					<p className="mt-2 text-sm text-kumo-subtle">{t`You need admin permissions to manage byline schema.`}</p>
				</div>
			</div>
		);
	}

	const fields = fieldsQuery.data?.items ?? [];

	const handleMove = (index: number, delta: -1 | 1) => {
		const targetIndex = index + delta;
		if (targetIndex < 0 || targetIndex >= fields.length) return;
		const next = [...fields];
		const a = next[index];
		const b = next[targetIndex];
		if (!a || !b) return;
		next[index] = b;
		next[targetIndex] = a;
		reorderMutation.mutate(next.map((f) => f.slug));
	};

	const handleCreate = (input: CreateBylineFieldInput | UpdateBylineFieldInput) => {
		if ("slug" in input && "type" in input) {
			createMutation.mutate(input);
		}
	};

	const handleEdit = (input: CreateBylineFieldInput | UpdateBylineFieldInput) => {
		if (!editingField) return;
		if (!("slug" in input) && !("type" in input)) {
			updateMutation.mutate({ slug: editingField.slug, input });
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold leading-tight">{t`Byline schema`}</h1>
					<p className="mt-1 text-sm leading-5 text-pretty text-kumo-subtle">
						{t`Define custom fields stored on every byline — job title, pronouns, social handles, and more.`}
					</p>
				</div>
				<Button icon={<Plus />} onClick={() => setCreating(true)}>
					{t`New field`}
				</Button>
			</div>

			<div className="rounded-md border bg-kumo-base overflow-x-auto">
				<table className="w-full">
					<thead>
						<tr className="border-b bg-kumo-tint/50">
							<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
								{t`Label`}
							</th>
							<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
								{t`Slug`}
							</th>
							<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
								{t`Type`}
							</th>
							<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
								{t`Translatable`}
							</th>
							<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
								{t`Required`}
							</th>
							<th scope="col" className="px-4 py-3 text-end text-sm font-medium">
								{t`Actions`}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-kumo-line">
						{fieldsQuery.isLoading ? (
							<tr>
								<td colSpan={6} className="px-4 py-8 text-center text-kumo-subtle">
									{t`Loading byline fields…`}
								</td>
							</tr>
						) : fieldsQuery.isError ? (
							<tr>
								<td colSpan={6} className="px-4 py-8 text-center">
									<p className="text-kumo-danger font-medium">{t`Couldn't load byline fields.`}</p>
									<p className="text-sm text-kumo-subtle mt-1">
										{fieldsQuery.error instanceof Error
											? fieldsQuery.error.message
											: t`An unexpected error occurred.`}
									</p>
									<Button
										variant="outline"
										size="sm"
										className="mt-3"
										onClick={() => void fieldsQuery.refetch()}
									>
										{t`Retry`}
									</Button>
								</td>
							</tr>
						) : fields.length === 0 ? (
							<tr>
								<td colSpan={6} className="px-4 py-12 text-center text-kumo-subtle">
									<IdentificationCard
										className="mx-auto h-8 w-8 mb-3 text-kumo-subtle"
										aria-hidden="true"
									/>
									<p>{t`No byline fields yet.`}</p>
									<p className="text-xs mt-1">
										{t`Add fields like "Job title" or "Pronouns" to enrich every byline.`}
									</p>
								</td>
							</tr>
						) : (
							fields.map((field, index) => (
								<FieldRow
									key={field.id}
									field={field}
									isFirst={index === 0}
									isLast={index === fields.length - 1}
									onMoveUp={() => handleMove(index, -1)}
									onMoveDown={() => handleMove(index, 1)}
									onEdit={() => setEditingField(field)}
									onDelete={() => setDeletingField(field)}
									reorderPending={reorderMutation.isPending}
								/>
							))
						)}
					</tbody>
				</table>
			</div>

			<BylineFieldEditor
				open={creating}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						createMutation.reset();
					}
				}}
				onSave={handleCreate}
				isSaving={createMutation.isPending}
				error={createMutation.error}
			/>

			{editingField && (
				<BylineFieldEditor
					key={editingField.id}
					open={!!editingField}
					onOpenChange={(open) => {
						if (!open) {
							setEditingField(null);
							updateMutation.reset();
						}
					}}
					field={editingField}
					usageTotal={usageQuery.data?.totalAffectedRows ?? 0}
					onSave={handleEdit}
					isSaving={updateMutation.isPending}
					error={updateMutation.error}
				/>
			)}

			<ConfirmDialog
				open={!!deletingField}
				onClose={() => {
					setDeletingField(null);
					deleteMutation.reset();
				}}
				title={t`Delete byline field?`}
				description={
					deletingField
						? deleteUsageQuery.isLoading
							? t`Checking how many stored values reference "${deletingField.label}"…`
							: deleteUsageQuery.isError
								? t`Couldn't verify how many values reference "${deletingField.label}". Deleting will still remove every stored value for this field — but the count above could not be checked.`
								: deleteUsageQuery.data && deleteUsageQuery.data.totalAffectedRows > 0
									? t`Deleting "${deletingField.label}" will also remove ${plural(
											deleteUsageQuery.data.totalAffectedRows,
											{ one: "# stored value", other: "# stored values" },
										)} across all bylines. This cannot be undone.`
									: t`Are you sure you want to delete "${deletingField.label}"? No stored values reference this field.`
						: ""
				}
				confirmLabel={t`Delete`}
				pendingLabel={t`Deleting…`}
				isPending={deleteMutation.isPending}
				error={deleteMutation.error}
				onConfirm={() => {
					if (deletingField) deleteMutation.mutate(deletingField.slug);
				}}
			/>
		</div>
	);
}

interface FieldRowProps {
	field: BylineFieldDefinition;
	isFirst: boolean;
	isLast: boolean;
	onMoveUp: () => void;
	onMoveDown: () => void;
	onEdit: () => void;
	onDelete: () => void;
	reorderPending: boolean;
}

function FieldRow({
	field,
	isFirst,
	isLast,
	onMoveUp,
	onMoveDown,
	onEdit,
	onDelete,
	reorderPending,
}: FieldRowProps) {
	const { t } = useLingui();
	return (
		<tr className="hover:bg-kumo-tint/25">
			<td className="px-4 py-3 font-medium">{field.label}</td>
			<td className="px-4 py-3">
				<code className="text-sm bg-kumo-tint px-1.5 py-0.5 rounded">{field.slug}</code>
			</td>
			<td className="px-4 py-3 text-sm">{field.type}</td>
			<td className="px-4 py-3 text-sm">
				{field.translatable ? t`Yes` : t`No (shared across translations)`}
			</td>
			<td className="px-4 py-3 text-sm">{field.required ? t`Yes` : t`No`}</td>
			<td className="px-4 py-3 text-end">
				<div className="flex items-center justify-end gap-1">
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={t`Move "${field.label}" up`}
						disabled={isFirst || reorderPending}
						onClick={onMoveUp}
					>
						<ArrowUp className="h-4 w-4" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={t`Move "${field.label}" down`}
						disabled={isLast || reorderPending}
						onClick={onMoveDown}
					>
						<ArrowDown className="h-4 w-4" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={t`Edit ${field.label}`}
						onClick={onEdit}
					>
						<Pencil className="h-4 w-4" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={t`Delete ${field.label}`}
						onClick={onDelete}
					>
						<Trash className="h-4 w-4 text-kumo-danger" aria-hidden="true" />
					</Button>
				</div>
			</td>
		</tr>
	);
}
