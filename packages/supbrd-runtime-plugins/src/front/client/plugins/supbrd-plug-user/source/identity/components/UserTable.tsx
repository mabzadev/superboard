import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import useDebounce from "../hooks/useDebounce.js";
import { useAuth } from "../melody-react.js";
import {
	useGetApiV1OrgsByIdUsersQuery,
	useGetApiV1UsersQuery,
	type User,
	useGetApiV1OrgsByIdAllUsersQuery,
} from "../services/auth/api.js";
import { configSignal } from "../signals/index.js";
import { accessTool, routeTool } from "../tools/index.js";
import useSignalValue from "../useSignalValue.js";
import EditLink from "./EditLink.js";
import EntityStatusLabel from "./EntityStatusLabel.js";
import IsSelfLabel from "./IsSelfLabel.js";
import LoadingPage from "./LoadingPage.js";
import Pagination from "./Pagination.js";
import { Alert } from "./ui/alert.js";
import { Input } from "./ui/input.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

const PageSize = 20;

const UserTable = ({
	orgId,
	loadedUsers,
	isViewingAllUsers = false,
}: {
	orgId: number | null;
	loadedUsers?: User[] | null;
	isViewingAllUsers?: boolean;
}) => {
	const t = useTranslations();

	const { userInfo } = useAuth();

	const configs = useSignalValue(configSignal);
	const [pageNumber, setPageNumber] = useState(1);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebounce(search);

	const canWriteUser = accessTool.isAllowedAccess(accessTool.Access.WriteUser, userInfo?.roles);

	const { data: usersData, isLoading: isUsersLoading } = useGetApiV1UsersQuery(
		{
			pageSize: PageSize,
			pageNumber,
			search: debouncedSearch || undefined,
		},
		{ skip: !!orgId },
	);

	const { data: orgUsersData, isLoading: isOrgUsersLoading } = useGetApiV1OrgsByIdUsersQuery(
		{
			id: Number(orgId),
			pageSize: PageSize,
			pageNumber,
			search: debouncedSearch || undefined,
		},
		{ skip: !orgId || isViewingAllUsers },
	);

	const { data: orgAllUsersData } = useGetApiV1OrgsByIdAllUsersQuery(
		{
			id: Number(orgId),
			pageSize: PageSize,
			pageNumber,
		},
		{ skip: !orgId || !isViewingAllUsers },
	);

	const data = orgId ? (isViewingAllUsers ? orgAllUsersData : orgUsersData) : usersData;

	const users = loadedUsers ?? data?.users ?? [];
	const count = data?.count ?? 0;

	const totalPages = useMemo(() => Math.ceil(count / PageSize), [count]);

	const handlePageChange = (page: number) => {
		setPageNumber(page);
	};

	if (isUsersLoading || isOrgUsersLoading) {
		return <LoadingPage />;
	}

	return (
		<section>
			{!loadedUsers && !isViewingAllUsers && (
				<header className="mb-6 flex items-center gap-4">
					<Input
						className="w-60"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("users.search")}
					/>
				</header>
			)}
			{data && data.count === 0 && <Alert>{t("users.noUsers")}</Alert>}
			{data && data.count !== 0 && (
				<Table>
					<TableHeader className="md:hidden">
						<TableRow>
							<TableHead>{t("users.user")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableHeader className="max-md:hidden">
						<TableRow>
							<TableHead>{t("users.authId")}</TableHead>
							<TableHead>{t("users.email")}</TableHead>
							<TableHead>{t("users.status")}</TableHead>
							{configs.ENABLE_NAMES && <TableHead>{t("users.name")}</TableHead>}
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody className="divide-y md:hidden">
						{users.map((user) => (
							<TableRow key={user.id} data-testid="userRow">
								<TableCell>
									<section className="flex items-center justify-between">
										<section className="flex flex-col gap-2">
											{user.authId}
											{user.authId === userInfo?.authId && (
												<div className="flex">
													<IsSelfLabel />
												</div>
											)}
											{user.email}
											<EntityStatusLabel isEnabled={user.isActive} isInviting={user.isInviting} />
											{configs.ENABLE_NAMES && (
												<p>{`${user.firstName ?? ""} ${user.lastName ?? ""}`}</p>
											)}
										</section>
										<EditLink
											viewOnly={!canWriteUser}
											href={`${routeTool.Internal.Users}/${user.authId}`}
										/>
									</section>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableBody className="divide-y max-md:hidden">
						{users.map((user) => (
							<TableRow key={user.id} data-testid="userRow">
								<TableCell>
									<div className="flex items-center gap-2">
										{user.authId}
										{user.authId === userInfo?.authId && <IsSelfLabel />}
									</div>
								</TableCell>
								<TableCell>{user.email}</TableCell>
								<TableCell>
									<EntityStatusLabel isEnabled={user.isActive} isInviting={user.isInviting} />
								</TableCell>
								{configs.ENABLE_NAMES && (
									<TableCell>{`${user.firstName ?? ""} ${user.lastName ?? ""}`}</TableCell>
								)}
								<TableCell>
									<EditLink
										viewOnly={!canWriteUser}
										href={`${routeTool.Internal.Users}/${user.authId}`}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
			{!loadedUsers && totalPages > 1 && (
				<Pagination
					className="mt-8"
					currentPage={pageNumber}
					totalPages={totalPages}
					onPageChange={handlePageChange}
					previousLabel={t("common.previous")}
					nextLabel={t("common.next")}
				/>
			)}
		</section>
	);
};

export default UserTable;
