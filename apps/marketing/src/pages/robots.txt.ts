import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
	const siteUrl = site ?? new URL("https://opaline.so");
	const sitemapUrl = new URL("/sitemap.xml", siteUrl);
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /vendor/",
		"",
		`Sitemap: ${sitemapUrl.href}`,
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
