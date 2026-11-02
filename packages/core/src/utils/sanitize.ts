import sanitizeHtml from "sanitize-html";

export function sanitizeContent(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "span", "iframe"],
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			"*": ["class", "id", "data-*"],
			iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
			img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
		},
		allowedIframeHostnames: ["www.youtube.com", "player.vimeo.com"],
	});
}
