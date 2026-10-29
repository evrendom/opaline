function homeOf(path: string): string | null {
	return /^(\/(?:Users|home)\/[^/]+)/u.exec(path)?.[1] ?? null;
}

function normalize(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

export function absolutePath(path: string, directory: string): string {
	if (path.startsWith("~/")) {
		const home = homeOf(directory);
		return home ? normalize(`${home}/${path.slice(2)}`) : path;
	}
	if (path.startsWith("/")) return normalize(path);
	if (directory.startsWith("/")) return normalize(`${directory}/${path}`);
	if (directory.startsWith("~/"))
		return `~${normalize(`${directory.slice(1)}/${path}`)}`;
	return path;
}

export function callDirectory(
	command: string | undefined,
	directory: string,
): string {
	let current = directory;
	let rest = command ?? "";
	for (;;) {
		const match =
			/^\s*cd\s+(?:"([^"$`]+)"|'([^']+)'|([^\s;&|$`"']+))\s*(?:&&|;)/u.exec(
				rest,
			);
		if (!match) return current;
		current = absolutePath(match[1] ?? match[2] ?? match[3] ?? "", current);
		rest = rest.slice(match[0].length);
	}
}
