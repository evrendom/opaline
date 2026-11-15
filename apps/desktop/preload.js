const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opalineDesktop", {
	introReady: () => ipcRenderer.send("app:intro-ready"),
	...(process.argv.includes("--opaline-debug") ? { replayOpen: () => ipcRenderer.send("app:replay-open") } : {}),
});
