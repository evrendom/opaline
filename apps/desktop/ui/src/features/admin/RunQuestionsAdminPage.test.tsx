import type { RunQuestion, RunQuestionTest } from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunQuestionsAdminPage } from "./RunQuestionsAdminPage";

/**
 * The internal form against a stand-in API that keeps the catalogue in
 * memory like the server: a new wording is a new draft, tests answer the
 * workspace's runs, and verdicts give the precision.
 */
const api = vi.hoisted(() => {
	const state = {
		questions: [] as RunQuestion[],
		tests: new Map<string, RunQuestionTest>(),
		testedWorkspaces: [] as string[],
		testedProviders: [] as (string | undefined)[],
	};
	let next = 1;
	const find = (id: string) => {
		const question = state.questions.find((item) => item.id === id);
		if (!question) throw new Error(`No run question ${id}.`);
		return question;
	};
	const add = (
		question: string,
		replaces: string | null = null,
		criteria: RunQuestion["criteria"] = null,
	) => {
		if (/\bpush\b/i.test(question))
			throw new Error(
				"L1 already records this exactly (git_operations, commit_shas, pushed_branches); query it with sql instead of asking a model.",
			);
		const added: RunQuestion = {
			id: `rq_${next++}`,
			question,
			label: null,
			criteria,
			state: "draft",
			replaces,
			testedRuns: null,
			testedPrecision: null,
			testedProvider: null,
			createdAt: "2026-10-12T10:00:00.000Z",
		};
		state.questions.unshift(added);
		return added;
	};
	return {
		state,
		reset() {
			state.questions = [];
			state.tests.clear();
			state.testedWorkspaces = [];
			state.testedProviders = [];
			next = 1;
		},
		runQuestions: {
			list: async () => ({
				questions: structuredClone(state.questions),
				providers: ["subq", "jev"],
			}),
			add: async ({
				question,
				criteria,
			}: {
				question: string;
				criteria?: RunQuestion["criteria"];
			}) => add(question, null, criteria ?? null),
			edit: async ({ id, question }: { id: string; question: string }) => {
				find(id).state = "retired";
				return add(question, id);
			},
			remove: async ({ id }: { id: string }) => {
				find(id).state = "retired";
				return find(id);
			},
			turnOn: async ({ id }: { id: string }) => {
				find(id).state = "on";
				return find(id);
			},
			test: async ({
				id,
				workspaceId,
				provider,
			}: {
				id: string;
				workspaceId: string;
				provider?: string;
			}) => {
				state.testedWorkspaces.push(workspaceId);
				state.testedProviders.push(provider);
				const test: RunQuestionTest = {
					status: "done",
					workspaceId,
					provider: provider ?? "subq",
					runs: [
						{
							sessionId: "s1",
							agentId: "",
							turn: 1,
							promptHead: "fix the login test",
							probability: 0.9,
						},
						{
							sessionId: "s1",
							agentId: "",
							turn: 2,
							promptHead: "login page copy",
							probability: 0.8,
						},
						{
							sessionId: "s2",
							agentId: "",
							turn: 1,
							promptHead: "rename the helper",
							probability: 0.1,
						},
					],
				};
				state.tests.set(id, test);
				return test;
			},
			testResult: async ({ id }: { id: string }) =>
				state.tests.get(id) ?? {
					status: "none",
					workspaceId: null,
					provider: null,
					runs: [],
				},
			recordVerdicts: async ({
				id,
				verdicts,
			}: {
				id: string;
				verdicts: {
					sessionId: string;
					agentId: string;
					turn: number;
					yes: boolean;
				}[];
			}) => {
				const runs = state.tests.get(id)?.runs ?? [];
				const answeredYes = verdicts.filter(
					(verdict) =>
						(runs.find(
							(run) =>
								run.sessionId === verdict.sessionId &&
								run.turn === verdict.turn,
						)?.probability ?? 0) >= 0.5,
				);
				const question = find(id);
				question.testedRuns = verdicts.length;
				question.testedPrecision =
					answeredYes.filter((verdict) => verdict.yes).length /
					answeredYes.length;
				return question;
			},
		},
	};
});

vi.mock("@/lib/orpc", () => ({
	client: { admin: { runQuestions: api.runQuestions } },
}));

vi.mock("@/features/workspace/organization/useOrganization", () => ({
	useOrganization: () => ({
		state: {
			activeOrg: { id: "org-own", name: "Opaline", slug: "opaline" },
			organizations: [
				{ id: "org-own", name: "Opaline", slug: "opaline" },
				{ id: "org-data", name: "Our data", slug: "our-data" },
			],
			isLoading: false,
		},
		actions: { switchOrganization: vi.fn() },
		meta: { isOrgAdmin: true, readsEverySession: true },
	}),
}));

function renderPage() {
	return render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<RunQuestionsAdminPage />
		</QueryClientProvider>,
	);
}

const question = (wording: string) =>
	screen
		.getAllByRole("listitem")
		.find((item) => within(item).queryByText(wording) !== null);

describe("RunQuestionsAdminPage", () => {
	beforeEach(() => api.reset());

	it("adds a draft, tests it on a chosen workspace's runs, records verdicts as precision, then turns it on", async () => {
		const user = userEvent.setup();
		renderPage();
		const wording = "Did the agent work on the login flow?";

		await user.type(screen.getByLabelText("New run question"), wording);
		await user.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByText(/Draft · Untested/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Test" }));
		await user.selectOptions(
			screen.getByLabelText("Test on the newest 20 runs of"),
			"org-data",
		);
		await user.click(screen.getByRole("button", { name: "Run test" }));
		const rows = await screen.findAllByRole("group", {
			name: /Is the answer yes/,
		});
		expect(api.state.testedWorkspaces).toEqual(["org-data"]);
		expect(screen.getByText("0.90")).toBeInTheDocument();

		// Yes for the first run, no for the second, which was answered yes too.
		await user.click(
			within(rows[0] as HTMLElement).getByRole("button", { name: "Yes" }),
		);
		await user.click(
			within(rows[1] as HTMLElement).getByRole("button", { name: "No" }),
		);
		await user.click(screen.getByRole("button", { name: "Save 2 verdicts" }));
		expect(
			await screen.findByText(/Draft · Precision 0.50 on 2 runs/),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Turn on" }));
		expect(await screen.findByText(/On · Precision 0.50/)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
	});

	it("adds a question with criteria for a subtle boundary, tests it with the provider picked, and shows how to write questions", async () => {
		const user = userEvent.setup();
		renderPage();

		expect(
			screen.getByText(/phrase it so a high value means yes/i),
		).toBeInTheDocument();
		await user.type(
			screen.getByLabelText("New run question"),
			"Did the user correct the agent?",
		);
		await user.click(screen.getByText("Criteria (optional)"));
		await user.type(
			screen.getByLabelText("A yes looks like"),
			"The next prompt says the agent got it wrong.",
		);
		await user.type(
			screen.getByLabelText("A no looks like"),
			"The next prompt moves on.",
		);
		await user.click(screen.getByRole("button", { name: "Add" }));
		expect(
			await screen.findByText(
				/Yes: The next prompt says the agent got it wrong/,
			),
		).toBeInTheDocument();
		expect(api.state.questions[0]?.criteria).toEqual({
			true: "The next prompt says the agent got it wrong.",
			false: "The next prompt moves on.",
		});

		await user.click(screen.getByRole("button", { name: "Test" }));
		await user.selectOptions(
			await screen.findByLabelText("Answered by"),
			"jev",
		);
		await user.click(screen.getByRole("button", { name: "Run test" }));

		expect(await screen.findByText("0.90")).toBeInTheDocument();
		expect(api.state.testedProviders).toEqual(["jev"]);
	});

	it("shows why a question about a recorded fact is refused, and saves a new wording as a new question", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.type(
			screen.getByLabelText("New run question"),
			"Did the agent push a commit?",
		);
		await user.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"L1 already records this exactly",
		);

		await user.clear(screen.getByLabelText("New run question"));
		await user.type(
			screen.getByLabelText("New run question"),
			"Did the agent go in circles?",
		);
		await user.click(screen.getByRole("button", { name: "Add" }));
		const row = await screen.findByText("Did the agent go in circles?");
		await user.click(
			within(question("Did the agent go in circles?") as HTMLElement).getByRole(
				"button",
				{ name: "Edit" },
			),
		);
		const edit = screen.getByLabelText("New wording");
		await user.clear(edit);
		await user.type(edit, "Did the agent repeat the same failing step?");
		await user.click(
			screen.getByRole("button", { name: "Save as new question" }),
		);

		expect(
			await screen.findByText("Did the agent repeat the same failing step?"),
		).toBeInTheDocument();
		expect(row).not.toBeInTheDocument();
		expect(screen.getByText("Removed and reworded (1)")).toBeInTheDocument();
	});
});
