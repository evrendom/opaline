const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opalineDesktop", {
	introReady: () => ipcRenderer.send("app:intro-ready"),
	...(process.argv.includes("--opaline-debug") ? { replayOpen: () => ipcRenderer.send("app:replay-open") } : {}),
	listRepositories: () => ipcRenderer.invoke("repositories:list"),
	applyRepositories: (options, onEvent) => {
		const id = crypto.randomUUID();
		const listener = (_event, eventId, payload) => {
			if (eventId === id && typeof onEvent === "function") onEvent(payload);
		};
		ipcRenderer.on("repositories:event", listener);
		return ipcRenderer
			.invoke("repositories:apply", id, options)
			.finally(() => ipcRenderer.removeListener("repositories:event", listener));
	},
});
