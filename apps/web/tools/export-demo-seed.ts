import { mkdir, writeFile } from "node:fs/promises";
import { SessionOverviewAnalyticsSchema } from "@rudel/api-routes";
import { z } from "zod";
import { DemoSeedSchema } from "../src/features/demo/demo-runtime";
import { getSessionOverviewCost } from "../src/features/sessions/components/sessions-overview-table-utils";

const base = "http://localhost:4600";
const organizationSchema = z.object({
	id: z.literal("1zKtWzbRInKT6uNOqgXdcEGinGo2rXuW"),
	name: z.string(),
	slug: z.string(),
	members: z.array(
		z.object({
			userId: z.string(),
			user: z.object({ name: z.string(), image: z.string().nullable() }),
		}),
	),
});
async function read(path: string, input?: unknown) {
	const response = await fetch(
		`${base}${path}`,
		input
			? {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ json: input }),
				}
			: undefined,
	);
	if (!response.ok)
		throw new Error(`Seed read failed: ${path} (${response.status})`);
	return response.json();
}
const dashboardInput = {
	startDate: "2026-08-01",
	endDate: "2026-08-31",
	requestedMetric: "cost",
};
// The other stat cards, as the dashboard requests them for their sparklines.
const previewInputs = [
	{ ...dashboardInput, requestedMetric: "sessions" },
	{
		...dashboardInput,
		requestedMetric: "agentRuns",
		durationInterval: "daily",
	},
	{ ...dashboardInput, requestedMetric: "signals" },
];
const [
	organizationData,
	sessionData,
	sessionsData,
	dashboardData,
	...previewData
] = await Promise.all([
	read("/api/auth/organization/get-full-organization"),
	read("/api/auth/get-session"),
	read("/rpc/analytics/sessions/list", {
		startDate: "2026-08-01",
		endDate: "2026-08-31",
		limit: 1000,
		sortBy: "session_date",
		sortOrder: "desc",
	}),
	read("/rpc/analytics/overview/costs", dashboardInput),
	...previewInputs.map((input) => read("/rpc/analytics/overview/costs", input)),
]);
const organization = organizationSchema.parse(organizationData);
const sessions = z
	.object({
		// Refuse an outdated deployment before overwriting the static preview.
		// The demo must consume the same complete contract as the live product.
		json: z.array(SessionOverviewAnalyticsSchema),
	})
	.parse(sessionsData).json;
if (sessions.length !== 85)
	throw new Error("Expected the approved 85-session demo");
const members = [];
await mkdir(new URL("../demo-public/demo-avatars/", import.meta.url), {
	recursive: true,
});
for (const member of organization.members.filter(
	(member) => member.user.image,
)) {
	const response = await fetch(new URL(member.user.image ?? "", base));
	if (
		!response.ok ||
		!response.headers.get("content-type")?.startsWith("image/")
	)
		throw new Error("Avatar unavailable");
	const extension = response.headers.get("content-type")?.includes("png")
		? "png"
		: "jpg";
	const filename = `${member.userId}.${extension}`;
	await writeFile(
		new URL(`../demo-public/demo-avatars/${filename}`, import.meta.url),
		Buffer.from(await response.arrayBuffer()),
	);
	members.push({
		userId: member.userId,
		name: member.user.name,
		image: `/product-demo/demo-avatars/${filename}`,
	});
}
const seed = DemoSeedSchema.parse({
	organization,
	members,
	viewerUserId: z
		.object({ user: z.object({ id: z.string() }) })
		.parse(sessionData).user.id,
	sessions: sessions.slice(0, 30),
	totalSessionCount: sessions.length,
	dashboard: {
		input: dashboardInput,
		data: z.object({ json: z.unknown() }).parse(dashboardData).json,
	},
	previews: previewInputs.map((input, index) => ({
		input,
		data: z.object({ json: z.unknown() }).parse(previewData[index]).json,
	})),
	maxima: {
		input: Math.max(...sessions.map((row) => row.input_tokens)),
		output: Math.max(...sessions.map((row) => row.output_tokens)),
		tokens: Math.max(
			...sessions.map((row) => row.input_tokens + row.output_tokens),
		),
		cost: Math.max(...sessions.map((row) => getSessionOverviewCost(row) ?? 0)),
	},
});
await writeFile(
	new URL("../src/features/demo/seed.json", import.meta.url),
	JSON.stringify(seed),
);
console.log(
	`Saved ${seed.sessions.length} preview rows and ${members.length} local avatars; no transcripts or credentials.`,
);
