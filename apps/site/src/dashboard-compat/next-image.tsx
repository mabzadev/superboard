import { forwardRef, type ImgHTMLAttributes } from "react";

type ImageSource = string | { height?: number; src: string; width?: number };

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "height" | "src" | "width"> & {
	alt: string;
	blurDataURL?: string;
	fill?: boolean;
	height?: number | `${number}`;
	loader?: unknown;
	placeholder?: "blur" | "empty" | `data:image/${string}`;
	priority?: boolean;
	quality?: number | `${number}`;
	src: ImageSource;
	unoptimized?: boolean;
	width?: number | `${number}`;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
	{
		blurDataURL: _blurDataURL,
		fill,
		height,
		loader: _loader,
		placeholder: _placeholder,
		priority,
		quality: _quality,
		src,
		unoptimized: _unoptimized,
		width,
		...props
	},
	ref,
) {
	const source = typeof src === "string" ? src : src.src;
	return (
		<img
			{...props}
			ref={ref}
			src={source}
			width={fill ? undefined : (width ?? (typeof src === "object" ? src.width : undefined))}
			height={fill ? undefined : (height ?? (typeof src === "object" ? src.height : undefined))}
			loading={priority ? "eager" : props.loading}
		/>
	);
});

export default Image;
