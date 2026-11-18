export const DOWNLOAD_PAGE_PATH = "/download/";

const RELEASE_DOWNLOADS =
	"https://github.com/evrendom/opaline/releases/download/desktop-latest";

export const DESKTOP_DOWNLOAD_URLS = {
	arm64:
		import.meta.env.PUBLIC_DESKTOP_DOWNLOAD_URL_ARM64?.trim() ||
		`${RELEASE_DOWNLOADS}/Opaline-macOS-arm64.dmg`,
	x64: (import.meta.env.PUBLIC_DESKTOP_DOWNLOAD_URL_X64 ?? "").trim(),
};

export type MacArchitecture = keyof typeof DESKTOP_DOWNLOAD_URLS;

interface UserAgentDataWithHints {
	getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
}

async function architectureFromClientHints(): Promise<MacArchitecture | null> {
	const userAgentData = (
		navigator as Navigator & { userAgentData?: UserAgentDataWithHints }
	).userAgentData;
	if (!userAgentData) return null;
	try {
		const { architecture } = await userAgentData.getHighEntropyValues([
			"architecture",
		]);
		if (architecture === "arm") return "arm64";
		if (architecture === "x86") return "x64";
	} catch {
		return null;
	}
	return null;
}

function architectureFromGraphics(): MacArchitecture | null {
	const gl = document.createElement("canvas").getContext("webgl");
	if (!gl) return null;
	const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
	const renderer = debugInfo
		? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
		: "";
	if (/Apple M\d/i.test(renderer)) return "arm64";
	if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "x64";
	return gl.getExtension("WEBGL_compressed_texture_astc") ? "arm64" : "x64";
}

export async function detectMacArchitecture(): Promise<MacArchitecture> {
	return (
		(await architectureFromClientHints()) ??
		architectureFromGraphics() ??
		"arm64"
	);
}
