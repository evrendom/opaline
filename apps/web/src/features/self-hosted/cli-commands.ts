export const OPALINE_CLOUD_ORIGIN = "https://opaline.so";
export const CLI_PACKAGE_COMMAND = "npx opaline@latest";
export const MCP_INSTALL_COMMAND = "opaline mcp install";
export const CLI_API_KEY_PLACEHOLDER = "<your CLI API key>";
export const MCP_SERVER_NAME = "opaline";

const CLOUD_LOGIN_COMMAND = `npm install -g opaline@latest && opaline login --api-base ${OPALINE_CLOUD_ORIGIN}`;

function isLoopbackHostname(hostname: string) {
	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)
	);
}

function normalizeOrigin(origin: string) {
	return new URL(origin).origin;
}

export function isOpalineCloudOrigin(origin: string) {
	return normalizeOrigin(origin) === OPALINE_CLOUD_ORIGIN;
}

export function serverArguments(origin: string): string[] {
	const url = new URL(origin);
	if (url.origin === OPALINE_CLOUD_ORIGIN) return [];
	const plaintextOverNetwork =
		url.protocol === "http:" && !isLoopbackHostname(url.hostname);
	return [
		"--server",
		url.origin,
		...(plaintextOverNetwork ? ["--allow-insecure-api-base"] : []),
	];
}

export function cliConnectCommand(
	base: string,
	code: string,
	origin: string,
): string {
	return [base, "--code", code, ...serverArguments(origin)].join(" ");
}

export function cliLoginCommand(origin: string): string {
	return [CLI_PACKAGE_COMMAND, "login", ...serverArguments(origin)].join(" ");
}

export function cliInstallAndLoginCommand(origin: string): string {
	if (isOpalineCloudOrigin(origin)) return CLOUD_LOGIN_COMMAND;
	return [
		"npm install -g opaline@latest && opaline login",
		...serverArguments(origin),
	].join(" ");
}

export function mcpEndpoint(origin: string): string {
	return `${normalizeOrigin(origin)}/api/mcp`;
}

export function claudeMcpAddCommand(origin: string): string {
	return `claude mcp add --scope user --transport http ${MCP_SERVER_NAME} ${mcpEndpoint(origin)} --header "Authorization: Bearer ${CLI_API_KEY_PLACEHOLDER}"`;
}

export function codexMcpConfig(origin: string): string {
	return [
		`[mcp_servers.${MCP_SERVER_NAME}]`,
		`url = "${mcpEndpoint(origin)}"`,
		"",
		`[mcp_servers.${MCP_SERVER_NAME}.http_headers]`,
		`Authorization = "Bearer ${CLI_API_KEY_PLACEHOLDER}"`,
	].join("\n");
}

export function cursorMcpConfig(origin: string): string {
	return JSON.stringify(
		{
			mcpServers: {
				[MCP_SERVER_NAME]: {
					url: mcpEndpoint(origin),
					headers: { Authorization: `Bearer ${CLI_API_KEY_PLACEHOLDER}` },
				},
			},
		},
		null,
		2,
	);
}
