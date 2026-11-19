const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opalineEnvironment", {
	connect: (url) => ipcRenderer.invoke("environment:connect", url),
});
