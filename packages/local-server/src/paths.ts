import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export function getSelfHostedMcpUrl(apiBase: string): string {
	return `${apiBase.replace(/\/+$/u, "")}/api/mcp`;
}

export function findExecutable(
	name: string,
	env: NodeJS.ProcessEnv,
): string | undefined {
	for (const directory of (env.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, name);
		try {
			accessSync(candidate, constants.X_OK);
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return undefined;
}
