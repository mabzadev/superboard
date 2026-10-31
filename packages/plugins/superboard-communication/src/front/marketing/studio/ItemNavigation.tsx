import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";

let leaveGuard: (() => Promise<boolean>) | null = null;

/** Lets an open editor flush its pending save before the workspace navigates away. */
export function setLeaveGuard(guard: (() => Promise<boolean>) | null) {
	leaveGuard = guard;
}

export async function canLeave() {
	if (!leaveGuard) return true;
	return leaveGuard().catch(() => false);
}

export function useCommunicationItem() {
	const params = useSearchParams();
	const router = useRouter();
	const select = (id: string, section = "content") => {
		const url = new URL(window.location.href);
		if (id) {
			url.searchParams.set("item", id);
			url.searchParams.set("section", section);
		} else {
			url.searchParams.delete("item");
			url.searchParams.delete("section");
		}
		router.push(url.pathname + url.search);
	};
	return { itemId: params.get("item") ?? "", section: params.get("section") ?? "content", select };
}
