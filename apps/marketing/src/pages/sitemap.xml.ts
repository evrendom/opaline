import type { APIRoute } from "astro";

const indexablePaths = [
	"/",
	"/pricing/",
	"/legal/privacy-policy/",
	"/legal/terms-of-service/",
	"/legal/data-processing-agreement/",
	"/legal/subprocessors/",
] as const;

const escapeXml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

export const GET: APIRoute = ({ site }) => {
	const siteUrl = site ?? new URL("https://opaline.so");
	const urls = indexablePaths
		.map(
			(path) =>
				`<url><loc>${escapeXml(new URL(path, siteUrl).href)}</loc></url>`,
		)
		.join("");
	const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

	return new Response(body, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
};
