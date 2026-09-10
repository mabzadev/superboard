"use client";

import dynamic from "@superboard/front-ui/next-dynamic";

import { Skeleton } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/skeleton.js";

const DynamicMessageDialog = dynamic(() => import("../messaging/MessageDialogWithEditor.js"), {
	loading: () => (
		<div className="flex items-center justify-center p-8">
			<Skeleton className="h-[400px] w-full rounded-md" />
		</div>
	),
	ssr: false,
});

export default DynamicMessageDialog;
