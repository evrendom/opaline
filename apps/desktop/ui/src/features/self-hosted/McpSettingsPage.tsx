import { Navigate } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import {
	CLI_API_KEY_PLACEHOLDER,
	CLI_PACKAGE_COMMAND,
	claudeMcpAddCommand,
	cliLoginCommand,
	codexMcpConfig,
	cursorMcpConfig,
	MCP_INSTALL_COMMAND,
	mcpEndpoint,
} from "./cli-commands";
import { SelfHostedCommand } from "./SelfHostedCommand";
import { useSelfHost } from "./self-host-info";
import "./self-hosted.css";

export function McpSettingsPage() {
	const selfHost = useSelfHost();
	const getShellRoutePath = useShellRoutePath();
	if (!selfHost)
		return (
			<Navigate replace to={getShellRoutePath(appRoutes.settingsWorkspace())} />
		);
	return <McpSettingsView origin={window.location.origin} />;
}

export function McpSettingsView({ origin }: { origin: string }) {
	return (
		<div className="settings-page">
			<WorkspaceSettingsGroup
				title="Install with the Opaline CLI"
				description="Registers this server's MCP in Claude Code, Codex and Cursor on the computer where you run it, with the API key the CLI saved when you signed in."
			>
				<div className="self-hosted-mcp-agent">
					<SelfHostedCommand
						command={MCP_INSTALL_COMMAND}
						label="MCP install command"
					/>
					<p>
						Without a global install, run{" "}
						<code>{CLI_PACKAGE_COMMAND} mcp install</code>. On a new computer,
						sign in first:
					</p>
					<SelfHostedCommand
						command={cliLoginCommand(origin)}
						label="CLI sign-in command"
					/>
				</div>
			</WorkspaceSettingsGroup>
			<WorkspaceSettingsGroup
				title="Add it by hand"
				description={`Every agent sends your CLI API key as a bearer token to ${mcpEndpoint(origin)}.`}
			>
				<div className="self-hosted-mcp-agent">
					<h3>Claude Code</h3>
					<SelfHostedCommand
						command={claudeMcpAddCommand(origin)}
						label="Claude Code command"
					/>
				</div>
				<div className="self-hosted-mcp-agent">
					<h3>Codex</h3>
					<p>
						Add to <code>~/.codex/config.toml</code>:
					</p>
					<SelfHostedCommand
						command={codexMcpConfig(origin)}
						label="Codex configuration"
					/>
				</div>
				<div className="self-hosted-mcp-agent">
					<h3>Cursor</h3>
					<p>
						Add to <code>~/.cursor/mcp.json</code>:
					</p>
					<SelfHostedCommand
						command={cursorMcpConfig(origin)}
						label="Cursor configuration"
					/>
				</div>
			</WorkspaceSettingsGroup>
			<p className="self-hosted-mcp-note">
				Replace <code>{CLI_API_KEY_PLACEHOLDER}</code> with the token in your
				Opaline CLI&apos;s <code>credentials.json</code>. Opaline never shows
				API keys in the browser.
			</p>
		</div>
	);
}
