import {
	Activity,
	Blocks,
	ChartNoAxesCombined,
	ChevronRight,
	Circle,
	CreditCard,
	Database,
	House,
	MessagesSquare,
	Settings2,
	Users,
	Workflow,
} from "@superboard/front-ui/icons";
import { useEffect, useState } from "react";

import type { organizeProductNavigation } from "../lib/product-navigation.js";

const icons = {
	home: House,
	users: Users,
	data: Database,
	sales: CreditCard,
	communication: MessagesSquare,
	automations: Workflow,
	analytics: ChartNoAxesCombined,
	settings: Settings2,
	operations: Activity,
	plugins: Blocks,
};

const iconByGroup = new Map(Object.entries(icons));

export function NativeFrontNavigation({
	navigation,
	collapsed,
	expand,
	closeMobile,
}: {
	navigation: ReturnType<typeof organizeProductNavigation>;
	collapsed: boolean;
	expand(): void;
	closeMobile(): void;
}) {
	const activeGroup = navigation.groups.find((group) =>
		group.items.some(({ href }) => href === navigation.activeHref),
	)?.group_id;
	const [opened, setOpened] = useState<string | undefined>(activeGroup);
	useEffect(() => setOpened(activeGroup), [activeGroup, navigation.activeHref]);
	return (
		<>
			{navigation.groups.map((group) => {
				const Icon = iconByGroup.get(group.icon ?? group.group_id) ?? Circle;
				const directItem = group.items.at(0);
				const direct =
					group.direct === true && group.items.length === 1 && directItem !== undefined;
				const label = group.label;
				return (
					<div
						key={group.group_id}
						className={
							["settings", "operations"].includes(group.icon ?? group.group_id)
								? "native-front-admin-navigation"
								: undefined
						}
					>
						{direct ? (
							<a
								className="native-front-direct-link"
								href={directItem.href}
								target={directItem.target}
								title={collapsed ? label : undefined}
								aria-current={activeGroup === group.group_id ? "page" : undefined}
								onClick={closeMobile}
							>
								<Icon className="native-front-group-icon" aria-hidden="true" size={17} />
								<span className="native-front-nav-label">{label}</span>
							</a>
						) : (
							<details open={!collapsed && opened === group.group_id}>
								<summary
									title={collapsed ? label : undefined}
									aria-expanded={!collapsed && opened === group.group_id}
									onClick={(event) => {
										event.preventDefault();
										setOpened(collapsed || opened !== group.group_id ? group.group_id : undefined);
										expand();
									}}
								>
									<Icon className="native-front-group-icon" aria-hidden="true" size={17} />
									<span className="native-front-nav-label">{label}</span>
									<ChevronRight
										className="native-front-group-chevron"
										aria-hidden="true"
										size={14}
									/>
								</summary>
								<nav aria-label={label}>
									{group.items.map((item) => (
										<a
											key={`${item.route_id}:${item.order}`}
											href={item.href}
											target={item.target}
											onClick={closeMobile}
											aria-current={item.href === navigation.activeHref ? "page" : undefined}
										>
											{item.label}
										</a>
									))}
								</nav>
							</details>
						)}
					</div>
				);
			})}
		</>
	);
}
