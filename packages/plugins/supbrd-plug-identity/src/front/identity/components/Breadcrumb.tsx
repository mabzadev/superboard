import classNames from "classnames";

import { useRouter } from "../i18n/navigation.js";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "./ui/breadcrumb.js";

const ShadcnBreadcrumb = ({
	parent,
	page,
	action,
	className,
}: {
	parent?: {
		label: string;
		href: string;
	};
	page?: {
		label: string;
	};
	action?: React.ReactNode;
	className?: string;
}) => {
	const router = useRouter();
	return (
		<section className={classNames("flex items-center gap-3 mb-8", className)}>
			<Breadcrumb>
				<BreadcrumbList>
					{parent && (
						<>
							<BreadcrumbItem className="cursor-pointer">
								<BreadcrumbLink
									onClick={() => {
										router.push(parent.href);
									}}
								>
									{parent.label}
								</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
						</>
					)}

					{page && (
						<>
							<h1 className="text-2xl font-bold tracking-tight leading-none">{page.label}</h1>
						</>
					)}
				</BreadcrumbList>
			</Breadcrumb>
			{action}
		</section>
	);
};

export default ShadcnBreadcrumb;
