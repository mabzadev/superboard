export {
	type PortableTextProps,
	type TypedObject,
	type SomePortableTextComponents,
	type Block,
	type ArbitraryTypedObject,
	type PortableTextBlock,
	type PortableTextMarkDefinition,
	type PortableTextSpan,
	type PortableTextListItemBlock,
	usePortableText,
	mergeComponents,
} from "astro-portabletext";

export {
	EmDashImage as Image,
	EmDashMedia as Media,
	PortableText,
	Block,
	WidgetArea,
	emdashComponents,
	Image as PTImage,
	Code,
	Embed,
	Gallery,
	Columns,
	Break,
	HtmlBlock,
	Superscript,
	Subscript,
	Underline,
	StrikeThrough,
	Link,
	EmDashHead,
	EmDashBodyStart,
	EmDashBodyEnd,
} from "./components/index.js";

export { Comments } from "./components/index.js";
export { CommentForm } from "./components/index.js";
