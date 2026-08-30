import type { ImgHTMLAttributes } from "react";

export interface StaticImageData {
	src: string;
	height: number;
	width: number;
	blurDataURL?: string;
}

export default function Image({
	src,
	alt,
	fill: _fill,
	priority: _priority,
	...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
	src: string | StaticImageData;
	alt: string;
	fill?: boolean;
	priority?: boolean;
}) {
	return <img src={typeof src === "string" ? src : src.src} alt={alt} {...props} />;
}
