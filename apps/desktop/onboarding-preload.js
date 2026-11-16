const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opalineOnboarding", {
	debug: process.argv.includes("--opaline-debug"),
	scan: () => ipcRenderer.invoke("onboarding:scan"),
	analyze: () => ipcRenderer.invoke("onboarding:analyze"),
	icons: () => ipcRenderer.invoke("onboarding:icons"),
	agents: () => ipcRenderer.invoke("onboarding:agents"),
	connect: (key) => ipcRenderer.invoke("onboarding:connect", key),
	theme: (theme) => ipcRenderer.send("onboarding:theme", theme),
	finish: (duration) => ipcRenderer.send("onboarding:finish", duration),
	expand: () => ipcRenderer.invoke("onboarding:expand"),
	passThrough: (through) => ipcRenderer.send("onboarding:pass-through", through),
});
