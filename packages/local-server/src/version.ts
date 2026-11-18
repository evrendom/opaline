import packageJson from "../package.json" with { type: "json" };

export function getLauncherVersion(): string {
	return packageJson.version;
}
