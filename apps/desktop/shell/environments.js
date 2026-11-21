const path = require("node:path");
const { BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const { environmentLabel } = require("./stack/settings");

function createEnvironmentMenu({
	stack,
	window,
	openWindow,
	quitCompletely,
	updates,
	platform = process.platform,
}) {
	const mac = platform === "darwin";
	let prompt;

	const current = () => stack.environment() ?? { kind: "local" };
	const rebuild = () => Menu.setApplicationMenu(build());

	async function switchTo(target) {
		const win = window();
		try {
			await stack.useEnvironment(target, win);
			if (!win) openWindow();
		} catch (error) {
			dialog.showErrorBox("Opaline", error.message);
		}
		rebuild();
	}

	function openPrompt() {
		if (prompt && !prompt.isDestroyed()) return prompt.focus();
		prompt = new BrowserWindow({
			width: 440,
			height: 196,
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			title: "Connect to Your Server",
			titleBarStyle: "hiddenInset",
			show: false,
			webPreferences: {
				spellcheck: false,
				preload: path.join(__dirname, "environment-preload.js"),
			},
		});
		prompt.once("ready-to-show", () => prompt.show());
		prompt.on("closed", () => {
			prompt = undefined;
		});
		prompt.loadFile(path.join(__dirname, "environment-window", "index.html"));
	}

	ipcMain.handle("environment:connect", async (event, url) => {
		if (!prompt || event.sender !== prompt.webContents)
			return { ok: false, message: "Not allowed." };
		const checked = await stack.checkServer(url);
		if (!checked.ok) return checked;
		prompt.close();
		await switchTo({ kind: "server", url: checked.url });
		return { ok: true };
	});

	function build() {
		const environment = current();
		const choices = [
			{
				label: mac ? "This Mac" : "This Computer",
				type: "radio",
				checked: environment.kind === "local",
				click: () => switchTo({ kind: "local" }),
			},
			...(environment.kind === "server"
				? [
						{
							label: environmentLabel(environment),
							type: "radio",
							checked: true,
							click: () => {},
						},
					]
				: []),
			{ type: "separator" },
			{ label: "Connect to Your Server…", click: openPrompt },
		];
		const quit = [
			{ role: "quit", label: "Quit Opaline" },
			{
				label: "Quit Opaline Completely",
				accelerator: "Alt+CommandOrControl+Q",
				click: quitCompletely,
			},
		];
		return Menu.buildFromTemplate([
			mac
				? {
						label: "Opaline",
						submenu: [
							{ role: "about" },
							...(updates ? [updates.menuItem()] : []),
							{ type: "separator" },
							{ role: "services" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							...quit,
						],
					}
				: {
						label: "File",
						submenu: [
							{
								label: "New Window",
								accelerator: "Control+N",
								click: openWindow,
							},
							...(updates ? [updates.menuItem()] : []),
							{ type: "separator" },
							...quit,
						],
					},
			{ role: "editMenu" },
			{ label: "Environment", submenu: choices },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]);
	}

	stack.on("environment", rebuild);
	updates?.on("change", rebuild);
	return build();
}

module.exports = { createEnvironmentMenu };
