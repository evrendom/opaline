const APP_LINK = /^opaline:(?:\/\/)?(.*)$/isu;
const SESSION_RESOURCE = /^sessions\/([^/?#]+)\/([^/?#]+)(.*)$/su;
const API_PATH = /^\/api(?:[/?#]|$)/iu;
const APP_LINK_IN_TEXT =
	/opaline:\/\/[^\s<>()[\]{}"'`]*[^\s<>()[\]{}"'`.,;:!?]/giu;

interface MarkdownNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
}

export function appLinkPath(url: string): string | null {
	const match = APP_LINK.exec(url.trim().replace(/[\t\n\r]/gu, ""));
	if (!match) return null;
	const rest = (match[1] ?? "")
		.replace(/^[/\\]+/u, "")
		.replace(SESSION_RESOURCE, "$1/sessions/$2$3");
	const path = `/${rest}`;
	return API_PATH.test(path) ? null : path;
}

function linkedText(value: string): MarkdownNode[] {
	const nodes: MarkdownNode[] = [];
	let from = 0;
	for (const match of value.matchAll(APP_LINK_IN_TEXT)) {
		const path = appLinkPath(match[0]);
		if (!path) continue;
		if (match.index > from)
			nodes.push({ type: "text", value: value.slice(from, match.index) });
		nodes.push({
			type: "link",
			url: path,
			children: [{ type: "text", value: match[0] }],
		});
		from = match.index + match[0].length;
	}
	if (!nodes.length) return [{ type: "text", value }];
	if (from < value.length)
		nodes.push({ type: "text", value: value.slice(from) });
	return nodes;
}

function rewrite(node: MarkdownNode, inLink: boolean): void {
	if (node.type === "link" && node.url) {
		const path = appLinkPath(node.url);
		if (path) node.url = path;
	}
	if (!node.children) return;
	const childInLink = inLink || node.type === "link";
	node.children = node.children.flatMap((child) => {
		if (child.type === "text" && !childInLink && child.value)
			return linkedText(child.value);
		rewrite(child, childInLink);
		return [child];
	});
}

export function remarkAppLinks() {
	return (tree: MarkdownNode) => rewrite(tree, false);
}
