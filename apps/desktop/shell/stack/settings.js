const fs = require("node:fs");
const path = require("node:path");

const CLOUD_URL = "https://opaline.so";
const ENVIRONMENT_KINDS = ["local", "server", "cloud"];

function isLoopback(hostname) {
	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)
	);
}

function defaultScheme(text) {
	const host = text.split(/[/:]/u)[0] ?? "";
	return isLoopback(host) ||
		/^\d{1,3}(\.\d{1,3}){3}$/u.test(host) ||
		host.endsWith(".local")
		? "http"
		: "https";
}

function normalizeServerUrl(input) {
	const text = String(input ?? "").trim();
	if (!text) return { ok: false, message: "Enter the address of your server." };
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(text)
		? text
		: `${defaultScheme(text)}://${text}`;
	let url;
	try {
		url = new URL(withScheme);
	} catch {
		return { ok: false, message: "That is not a web address." };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		return { ok: false, message: "Use an http:// or https:// address." };
	if (url.username || url.password)
		return {
			ok: false,
			message: "Leave the user name and password out of the address.",
		};
	if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
		return {
			ok: false,
			message:
				"Use the server's address without a path, like https://opaline.example.com.",
		};
	return {
		ok: true,
		url: url.origin,
		plaintext: url.protocol === "http:" && !isLoopback(url.hostname),
	};
}

function environmentLabel(environment) {
	if (!environment) return "Not set up";
	if (environment.kind === "local") return "This Mac";
	if (environment.kind === "cloud") return "Opaline Cloud";
	try {
		return new URL(environment.url).host;
	} catch {
		return "Your server";
	}
}

function environmentOrigin(environment, localUrl) {
	if (!environment) return undefined;
	if (environment.kind === "local")
		return localUrl ? new URL(localUrl).origin : undefined;
	if (environment.kind === "cloud") return CLOUD_URL;
	return environment.url ? new URL(environment.url).origin : undefined;
}

function validateEnvironment(value) {
	if (
		!value ||
		typeof value !== "object" ||
		!ENVIRONMENT_KINDS.includes(value.kind)
	)
		return undefined;
	if (value.kind === "local") return { kind: "local" };
	if (value.kind === "cloud") return { kind: "cloud", url: CLOUD_URL };
	const normalized = normalizeServerUrl(value.url);
	return normalized.ok
		? { kind: "server", url: normalized.url, plaintext: normalized.plaintext }
		: undefined;
}

function createSettingsStore(directory) {
	const file = path.join(directory, "settings.json");
	let cached;
	function read() {
		if (cached) return cached;
		try {
			const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
			cached = {
				environment: validateEnvironment(parsed.environment),
				onboardedAt:
					typeof parsed.onboardedAt === "string"
						? parsed.onboardedAt
						: undefined,
				theme:
					parsed.theme === "light" || parsed.theme === "dark"
						? parsed.theme
						: "system",
				uploadsPaused: parsed.uploadsPaused === true,
				historyImportedAt:
					typeof parsed.historyImportedAt === "string"
						? parsed.historyImportedAt
						: undefined,
			};
		} catch {
			cached = {
				environment: undefined,
				onboardedAt: undefined,
				theme: "system",
				uploadsPaused: false,
			};
		}
		return cached;
	}
	function write(patch) {
		const next = { ...read(), ...patch };
		fs.mkdirSync(directory, { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
			mode: 0o600,
		});
		fs.renameSync(temporary, file);
		cached = next;
		return next;
	}
	return { file, read, write };
}

module.exports = {
	CLOUD_URL,
	createSettingsStore,
	environmentLabel,
	environmentOrigin,
	isLoopback,
	normalizeServerUrl,
	validateEnvironment,
};
