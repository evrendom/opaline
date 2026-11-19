export function markupText(markup: string) {
	return markup
		.replace(/<(style|template)[\s\S]*?<\/\1\s*>/g, "")
		.replace(/<[^>]+>/g, "");
}

export function elementText(element: Element) {
	const copy = element.cloneNode(true) as Element;
	for (const hidden of copy.querySelectorAll("template, style"))
		hidden.remove();
	return copy.textContent ?? "";
}
