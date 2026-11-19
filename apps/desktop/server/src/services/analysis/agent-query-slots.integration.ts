import "../../__tests__/helpers/local-integration-guard.js";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import postgres from "postgres";
import {
	AgentQueryBusyError,
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "./agent-query-slots.js";

/**
 * The agent query limiter against real Postgres. Each simulated API instance
 * has its own client and limiter, as Vercel's instances do; they share only
 * the slot table.
 */

setDefaultTimeout(30_000);

const RUN = `agent_slots_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspaces = Array.from({ length: 6 }, (_, index) => `${RUN}_ws${index}`);
const clients: postgres.Sql[] = [];

function client(): postgres.Sql {
	const sql = postgres(process.env.PG_CONNECTION_STRING ?? "", {
		max: 3,
		prepare: false,
	});
	clients.push(sql);
	return sql;
}

/** An API instance: its own Postgres client and limiter. */
function instance(
	options: { waitMs?: number; leaseMs?: number } = {},
): ReturnType<typeof createAgentQueryLimiter> {
	return createAgentQueryLimiter(
		createPostgresAgentQuerySlots(client(), { leaseMs: options.leaseMs }),
		{ waitMs: options.waitMs ?? 3_000 },
	);
}

const admin = client();

beforeAll(async () => {
	for (const id of workspaces)
		await admin`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
});

beforeEach(async () => {
	await admin`UPDATE analysis_query_slot SET organization_id = NULL, lease_token = NULL, lease_expires_at = NULL`;
});

afterAll(async () => {
	await admin`UPDATE analysis_query_slot SET organization_id = NULL, lease_token = NULL, lease_expires_at = NULL`;
	for (const id of workspaces)
		await admin`DELETE FROM organization WHERE id = ${id}`;
	await Promise.all(clients.map((sql) => sql.end()));
});

/** Work that counts how many of each workspace run at once, until `hold` resolves. */
function meter() {
	const running = new Map<string, number>();
	const most = new Map<string, number>();
	return {
		mostIn: (workspaceId: string) => most.get(workspaceId) ?? 0,
		work: (workspaceId: string, hold: () => Promise<unknown>) => async () => {
			const now = (running.get(workspaceId) ?? 0) + 1;
			running.set(workspaceId, now);
			most.set(workspaceId, Math.max(most.get(workspaceId) ?? 0, now));
			try {
				await hold();
			} finally {
				running.set(workspaceId, (running.get(workspaceId) ?? 1) - 1);
			}
		},
	};
}

const pause = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Work held until `open()`; `started` resolves once `count` of them run. */
function gate(count: number) {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	let begun = 0;
	let allStarted = () => {};
	const started = new Promise<void>((resolve) => {
		allStarted = resolve;
	});
	return {
		open,
		started,
		work: async () => {
			begun++;
			if (begun === count) allStarted();
			await opened;
		},
	};
}

describe("agent query slots across API instances", () => {
	test("one workspace runs at most 2 at once, on any instances, and leaves the other slots to other workspaces", async () => {
		const [busy, other] = workspaces as [string, string];
		const instances = [instance(), instance(), instance()];
		const counter = meter();
		const held = gate(2);
		const calls = [0, 1, 2, 3, 4].map((call) =>
			instances[call % instances.length]?.withAgentQuerySlot(
				busy,
				counter.work(busy, held.work),
			),
		);
		await held.started;
		// The busy workspace holds 2 slots; another workspace gets one at once.
		await instance({ waitMs: 0 }).withAgentQuerySlot(
			other,
			counter.work(other, async () => {}),
		);
		held.open();

		await Promise.all(calls);
		expect(counter.mostIn(busy)).toBe(2);
	});

	test("while 4 queries run on one instance, a fifth on another waits, is refused as busy and never runs", async () => {
		const holder = instance();
		const held = gate(4);
		const holding = workspaces
			.slice(0, 4)
			.map((workspaceId) => holder.withAgentQuerySlot(workspaceId, held.work));
		await held.started;

		let ran = false;
		const started = Date.now();
		const refused = instance({ waitMs: 400 }).withAgentQuerySlot(
			workspaces[4] as string,
			async () => {
				ran = true;
			},
		);

		await expect(refused).rejects.toThrow(AgentQueryBusyError);
		await expect(refused).rejects.toThrow(
			"The analysis service is busy; retry in a moment.",
		);
		const waited = Date.now() - started;
		expect(waited).toBeGreaterThanOrEqual(400);
		expect(waited).toBeLessThan(2_000);
		expect(ran).toBe(false);
		held.open();
		await Promise.all(holding);
	});

	test("slots whose holder never released them (a crashed instance) are taken again once their leases expire, by the same workspace too", async () => {
		const crashed = createPostgresAgentQuerySlots(client(), { leaseMs: 1_500 });
		const [first, second] = workspaces as [string, string];
		// Every slot, and both of the first workspace's.
		for (const workspaceId of [first, first, second, second])
			expect(await crashed.take(workspaceId)).not.toBeNull();
		expect(await crashed.take(workspaces[2] as string)).toBeNull();

		const started = Date.now();
		const ran = await instance({ waitMs: 3_000 }).withAgentQuerySlot(
			first,
			async () => "ran",
		);

		expect(ran).toBe("ran");
		expect(Date.now() - started).toBeLessThan(3_000);
	});

	test("a query that fails gives its slot back and its error to the caller", async () => {
		const limiter = instance({ waitMs: 0 });
		const workspaceId = workspaces[0] as string;
		for (let call = 0; call < 3; call++)
			await expect(
				limiter.withAgentQuerySlot(workspaceId, async () => {
					throw new Error("query failed");
				}),
			).rejects.toThrow("query failed");

		// Both of the workspace's slots are free again at once.
		const both = await Promise.all(
			[0, 1].map(() =>
				limiter.withAgentQuerySlot(workspaceId, () => pause(100)),
			),
		);
		expect(both.length).toBe(2);
	});

	test("deleting a workspace leaves no slot keyed by it; its running query still gives the slot back", async () => {
		const deleted = `${RUN}_deleted_ws`;
		await admin`INSERT INTO organization (id, name, slug) VALUES (${deleted}, ${deleted}, ${deleted})`;
		const held = gate(1);
		const running = instance({ waitMs: 0 }).withAgentQuerySlot(
			deleted,
			held.work,
		);
		await held.started;
		const keyed = () =>
			admin<{ slot: number }[]>`
				SELECT slot FROM analysis_query_slot WHERE organization_id = ${deleted}
			`;
		expect((await keyed()).length).toBe(1);

		// As deleteOrganizationPostgresData deletes it.
		await admin`DELETE FROM organization WHERE id = ${deleted}`;
		expect((await keyed()).length).toBe(0);

		held.open();
		await running;
		const leased = await admin<{ slot: number }[]>`
			SELECT slot FROM analysis_query_slot WHERE lease_token IS NOT NULL
		`;
		expect(leased.length).toBe(0);

		// A later query of the deleted workspace is refused as busy, not a database error.
		await expect(
			instance({ waitMs: 0 }).withAgentQuerySlot(deleted, async () => {}),
		).rejects.toThrow(AgentQueryBusyError);
	});

	test("a query that runs past its lease keeps its slot: the holder renews the lease", async () => {
		const workspaceId = workspaces[0] as string;
		const holder = instance({ leaseMs: 600 });
		const held = gate(2);
		const holding = [0, 1].map(() =>
			holder.withAgentQuerySlot(workspaceId, held.work),
		);
		await held.started;
		await pause(1_200);

		await expect(
			instance({ waitMs: 0 }).withAgentQuerySlot(workspaceId, async () => {}),
		).rejects.toThrow(AgentQueryBusyError);
		held.open();
		await Promise.all(holding);
	});

	test("a cancelled call stops waiting for a slot and never runs", async () => {
		const holder = instance();
		const held = gate(4);
		const holding = workspaces
			.slice(0, 4)
			.map((workspaceId) => holder.withAgentQuerySlot(workspaceId, held.work));
		await held.started;

		let ran = false;
		const cancel = new AbortController();
		const started = Date.now();
		const waiting = instance({ waitMs: 3_000 }).withAgentQuerySlot(
			workspaces[4] as string,
			async () => {
				ran = true;
			},
			cancel.signal,
		);
		setTimeout(() => cancel.abort(new Error("request cancelled")), 200);

		await expect(waiting).rejects.toThrow("request cancelled");
		expect(Date.now() - started).toBeLessThan(1_500);
		expect(ran).toBe(false);
		held.open();
		await Promise.all(holding);
	});
});
