import { getFrontendOrigin } from "../frontend-origin.js";

export const DASHBOARD_WIDGET_URI = "ui://opaline/dashboard.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** The Opaline mark as a monochrome 20px sidebar icon (`currentColor`). */
export const OPALINE_ICON = {
	src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iLTYwIC02MCAxMTY5IDExNjIiPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNNTI0LjUzMiAwQzY2MS43MjUgNC41MjQyNSA3OTMuOTU2IDIwLjM4OTIgODkwLjE5IDEwMy40OTRDOTg2Ljc0NiAxODMuMzEzIDEwNDcuMjQgMzMwLjMyOSAxMDQ5IDUyMC42NUMxMDQ3LjI0IDcxMC45MTMgOTg2Ljc0NiA4NTcuOTkgODkwLjE5IDkzNy44MTdDNzkzLjk1NiAxMDIwLjkyIDY2MS43OSAxMDM2Ljc5IDUyNC41MzIgMTA0MS4zQzM4Ny4yNzQgMTAzNi43OSAyNTUuMSAxMDIwLjkyIDE1OC44NjYgOTM3LjgxN0M2Mi4zMTgyIDg1Ny45OSAxLjc2NzE2IDcxMS4wMDYgMCA1MjAuNjg0TDAuMDY0MDI1OSA1MjAuNjE2QzEuNzU4NzYgMzMwLjI0NSA2Mi4zMTg1IDE4My4yNDUgMTU4Ljg2NiAxMDMuNDk0QzI1NS4xIDIwLjM4OTIgMzg3LjI3NCA0LjUyNDI2IDUyNC41MzIgMFpNNTI0LjUxOCAyMjkuNDY5QzQ0Ny44NDcgMjMxLjk5NyAzNzQuMDE1IDI0MC44NjIgMzIwLjI1OSAyODcuM0MyNjYuMzI4IDMzMS44NjQgMjMyLjUgNDE0LjAwNyAyMzEuNTU0IDUyMC4zODRMMjMxLjUxOCA1MjAuNDJDMjMyLjUwNSA2MjYuNzcgMjY2LjMyOCA3MDguOTA0IDMyMC4yNTkgNzUzLjUxMUMzNzQuMDE1IDc5OS45NDggNDQ3Ljg0NyA4MDguODEzIDUyNC41MTggODExLjMzNkM2MDEuMTg5IDgwOC44MTMgNjc1LjAxNyA3OTkuOTQ4IDcyOC43NzMgNzUzLjUxMUM3ODIuNzA4IDcwOC45MDQgODE2LjUgNjI2LjcxOSA4MTcuNDgyIDUyMC40MDJDODE2LjUgNDE0LjA1MyA3ODIuNzA4IDMzMS45MDIgNzI4Ljc3MyAyODcuM0M2NzUuMDE3IDI0MC44NjIgNjAxLjE1MyAyMzEuOTk3IDUyNC41MTggMjI5LjQ2OVoiLz48L3N2Zz4=",
	mimeType: "image/svg+xml",
	sizes: ["20x20"],
};

export function pluginAssetOrigin() {
	return new URL(process.env.APP_URL ?? getFrontendOrigin()).origin;
}

// The plugin app is the web app built in plugin mode (`build:widget`) and
// served from our origin under /plugin/. Hosts cache this HTML for hours, so
// it only names the short-lived entry; the base (allowed by `baseUriDomains`)
// makes the app's public assets resolve there too.
export function readDashboardWidgetHtml() {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Opaline</title><base href="${pluginAssetOrigin()}/plugin/"><body class="style-luma"><div id="root"></div><script type="module" src="${pluginAssetOrigin()}/plugin/entry.js"></script></body></html>`;
}
