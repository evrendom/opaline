/**
 * Screenshots of the Opaline plugin app for the OpenAI plugin directory
 * listing: 706 px wide, 860 px tall.
 *
 * Builds the plugin app (`apps/web build:widget`), serves it locally, opens the
 * same resource HTML `get_dashboard` declares (`ui://opaline/dashboard.html`)
 * in Chrome and gives it a get_dashboard result built from the product demo
 * seed (`apps/web/src/features/demo/seed.json`), the shape the tool returns in
 * `_meta["opaline/widget"]`. The seed's people, repositories and workspace are
 * replaced with fictional ones (FICTIONAL); the run fails if any survive. The dashboard needs no other tool call; any the
 * app makes (`app_*`) is answered from the same seed or listed at the end.
 * The per-member breakdown is hidden: the listing shows team patterns
 * (trend, repositories, models), never a ranking of named people.
 *
 *   bun scripts/plugin-screenshots.ts [--skip-build]
 *
 * Uses the installed Google Chrome; set PLAYWRIGHT_CHANNEL=chromium to use
 * Playwright's bundled browser instead.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { CostDashboardInputSchema } from "../packages/api-routes/src/index.ts";

const ROOT = join(import.meta.dir, "..");
const WEB = join(ROOT, "apps/web");
const DIST = join(WEB, "dist-plugin");
const OUT = join(ROOT, "plugins/opaline/assets/screenshots");
const WIDTH = 706;
const HEIGHT = 860;
/** Seed value → fictional value, applied to the serialized dashboard. */
const FICTIONAL: Record<string, string> = {
	fOsrHjK6ZflgAMB0zvQqrDiH8MSao4cB: "user-alex",
	UaR49qBKWaEm895jKnE3PRaagPuAMNoX: "user-sam",
	JvNG2QdiIKjb8MBDE6gFb56c4pSCHbEX: "user-priya",
	Rafa: "Alex",
	Evren: "Sam",
	Marc: "Priya",
	"evrendom/rudel": "acme-demo/acme-invoices",
	"opalinehq/athena": "acme-demo/web-app",
	"1zKtWzbRInKT6uNOqgXdcEGinGo2rXuW": "workspace-acme-demo",
	"Opaline Demo": "Acme Demo",
	"opaline-demo": "acme-demo",
};
const REAL = /rafa|evren|marc|evrendom|opalinehq|rudel|athena|avatar/iu;

interface Shot {
	file: string;
	theme: "light" | "dark";
	displayMode: "inline" | "fullscreen";
	/** Pixels to scroll the app down before the screenshot. */
	scroll?: number;
}

const SHOTS: Shot[] = [
	{ file: "01-dashboard.png", theme: "light", displayMode: "fullscreen" },
	{ file: "02-dashboard-dark.png", theme: "dark", displayMode: "fullscreen" },
	{
		file: "03-dashboard-breakdowns.png",
		theme: "light",
		displayMode: "fullscreen",
		scroll: 560,
	},
];

if (!process.argv.includes("--skip-build")) {
	const build = Bun.spawnSync(["bun", "run", "build:widget"], {
		cwd: WEB,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (build.exitCode !== 0) throw new Error("build:widget failed");
}

const seed = await Bun.file(
	join(WEB, "src/features/demo/seed.json"),
).json();
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/") {
			return new Response(widgetHtml, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}
		const file = Bun.file(join(DIST, pathname.replace(/^\/plugin\//u, "/")));
		return (await file.exists())
			? new Response(file)
			: new Response("Not Found", { status: 404 });
	},
});
const origin = `http://localhost:${server.port}`;
// The exact resource HTML the MCP server returns, pointed at this server.
process.env.APP_URL = origin;
const { readDashboardWidgetHtml } = await import(
	"../apps/api/src/mcp/dashboard-widget.ts"
);
const widgetHtml = readDashboardWidgetHtml();
const widget = pluginSeed();
const unanswered = new Set<string>();

const browser = await chromium.launch({
	channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
});
await mkdir(OUT, { recursive: true });
try {
	for (const shot of SHOTS) {
		const page = await browser.newPage({
			viewport: { width: WIDTH, height: HEIGHT },
			deviceScaleFactor: 1,
			colorScheme: shot.theme,
		});
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.exposeFunction("__opalineCallTool", (name: string) =>
			answerTool(name),
		);
		await page.addInitScript(
			({ widget, shot }) => {
				const call = (window as unknown as Record<string, unknown>)
					.__opalineCallTool as (name: string) => Promise<unknown>;
				(window as unknown as { openai: unknown }).openai = {
					theme: shot.theme,
					displayMode: shot.displayMode,
					toolResponseMetadata: { "opaline/widget": widget },
					setWidgetState: () => {},
					callTool: (name: string) => call(name),
					openExternal: () => {},
				};
			},
			// As get_dashboard sends it: no roster and no rows naming people.
			{
				widget: {
					...widget,
					members: undefined,
					account: undefined,
					dashboard: {
						...widget.dashboard,
						data: withoutPersonRows(widget.dashboard.data),
					},
				},
				shot,
			},
		);
		await page.goto(origin);
		await page.waitForLoadState("networkidle");
		await page.addStyleTag({
			content: 'section[data-dimension="members"] { display: none !important; }',
		});
		if (shot.scroll) {
			await page.mouse.move(WIDTH / 2, HEIGHT / 2);
			await page.mouse.wheel(0, shot.scroll);
			// Off the cards, so no hover toolbar shows.
			await page.mouse.move(4, HEIGHT / 2);
		}
		// Charts animate in; images and fonts settle after network idle.
		await page.waitForTimeout(1500);
		const path = join(OUT, shot.file);
		await page.screenshot({ path });
		if (errors.length) throw new Error(`${shot.file}: ${errors.join("; ")}`);
		console.log(`wrote ${path}`);
		await page.close();
	}
} finally {
	await browser.close();
	server.stop(true);
}
if (unanswered.size)
	console.log(`unanswered app tools: ${[...unanswered].join(", ")}`);

/** The `widget` get_dashboard returns, from the demo seed made fictional. */
function pluginSeed() {
	let json = JSON.stringify({
		organization: seed.organization,
		members: seed.members.map(
			({ userId, name }: { userId: string; name: string }) => ({
				userId,
				name,
			}),
		),
		dashboard: seed.dashboard,
	});
	for (const [real, fictional] of Object.entries(FICTIONAL))
		json = json.replaceAll(real, fictional);
	const sample = JSON.parse(json);
	// Avatars would be real photos; the app shows initials instead.
	for (const metric of Object.values(sample.dashboard.data.metrics) as ({
		breakdowns: { members?: { image: string | null }[] };
	} | null)[])
		for (const row of metric?.breakdowns.members ?? []) row.image = null;
	const leftover = JSON.stringify(sample).match(REAL);
	if (leftover) throw new Error(`Real seed data left: ${leftover[0]}`);

	const members = sample.members.map(
		(member: { userId: string; name: string }, index: number) => ({
			id: `member-${index}`,
			userId: member.userId,
			role: index === 0 ? "owner" : "member",
			user: { id: member.userId, name: member.name, image: null },
		}),
	);
	const owner = members[0];
	return {
		query: {
			workspace: sample.organization.slug,
			startDate: sample.dashboard.input.startDate,
			endDate: sample.dashboard.input.endDate,
			metric: "cost",
			splitBy: "none",
			members: [],
			repositories: [],
			models: [],
		},
		// The exact input (and cache key) get_dashboard sends, so the first
		// view renders from this data as it does for users.
		dashboard: {
			...sample.dashboard,
			input: CostDashboardInputSchema.parse(sample.dashboard.input),
		},
		members,
		// What app_account answers when a view needs the caller's account.
		account: {
			session: {
				user: owner.user,
				session: {
					id: "screenshot",
					userId: owner.userId,
					activeOrganizationId: sample.organization.id,
					expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
				},
			},
			member: owner,
		},
		// The same minimal bootstrap get_dashboard sends (readPluginBootstrap):
		// the workspace only; the roster and the account load on demand.
		bootstrap: {
			organization: {
				...sample.organization,
				logo: null,
				members: [],
				invitations: [],
			},
		},
	};
}

/** Plugin tools answer `{ result }` in structuredContent, as mcp-http does. */
function answerTool(name: string) {
	if (name === "workspace_members")
		return { structuredContent: { members: widget.members } };
	if (name === "app_account") return { structuredContent: widget.account };
	const results: Record<string, unknown> = {
		app_dashboard_metrics: widget.dashboard.data,
	};
	if (name in results)
		return { structuredContent: { result: results[name] } };
	unanswered.add(name);
	return {
		isError: true,
		structuredContent: {
			error: { code: "NOT_FOUND", status: 404, message: "Not in the sample." },
		},
	};
}

/** Mirrors `withoutPersonRows` in apps/api/src/mcp/mcp-tools.ts. */
function withoutPersonRows<T extends { metrics: Record<string, unknown> }>(
	data: T,
): T {
	return {
		...data,
		metrics: Object.fromEntries(
			Object.entries(data.metrics).map(([name, metric]) => [
				name,
				metric && typeof metric === "object" && "breakdowns" in metric
					? {
							...metric,
							breakdowns: {
								...(metric.breakdowns as object),
								members: [],
								githubAuthors: [],
							},
						}
					: metric,
			]),
		),
	};
}
