import { useCallback, useRef, useState } from "react";

interface UseResizableOptions {
	initial: number;
	min: number;
	max: number;
}

interface UseResizableReturn {
	width: number;
	isDragging: boolean;
	handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizable({ initial, min, max }: UseResizableOptions): UseResizableReturn {
	const [width, setWidth] = useState(initial);
	const [isDragging, setIsDragging] = useState(false);
	const startX = useRef(0);
	const startWidth = useRef(0);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			startX.current = e.clientX;
			startWidth.current = width;
			setIsDragging(true);

			function onMouseMove(moveEvent: MouseEvent) {
				const delta = moveEvent.clientX - startX.current;
				const newWidth = Math.min(max, Math.max(min, startWidth.current + delta));
				setWidth(newWidth);
			}

			function onMouseUp() {
				setIsDragging(false);
				document.removeEventListener("mousemove", onMouseMove);
				document.removeEventListener("mouseup", onMouseUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			}

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		},
		[width, min, max],
	);

	return { width, isDragging, handleMouseDown };
}
