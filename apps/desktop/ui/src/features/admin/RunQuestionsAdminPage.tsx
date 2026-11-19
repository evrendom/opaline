import {
	RUN_QUESTION_LABEL_MAX_CHARS,
	type RunQuestion,
	type RunQuestionCriteria,
	type RunQuestionTest,
} from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client } from "@/lib/orpc";

const QUESTIONS_KEY = ["admin", "runQuestions"] as const;
const testKey = (id: string, provider: string) =>
	[...QUESTIONS_KEY, "test", id, provider] as const;
/** A queued test is answered by the minute cron; poll until it is done. */
const TEST_POLL_MS = 5_000;

// Operator-only form for the run question catalogue (CONTEXT.md "Run
// question"). Like the admin dashboard it sits outside the app shell and
// nothing links to it; the API refuses everyone outside the admin
// organization.
export function RunQuestionsAdminPage() {
	const queryClient = useQueryClient();
	const questions = useQuery({
		queryKey: QUESTIONS_KEY,
		queryFn: () => client.admin.runQuestions.list({}),
	});
	const [error, setError] = useState<string | null>(null);
	const [testing, setTesting] = useState<string | null>(null);

	const act = async (work: () => Promise<unknown>) => {
		setError(null);
		try {
			await work();
			await queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
			return true;
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
			return false;
		}
	};

	const live = questions.data?.questions.filter(
		(question) => question.state !== "retired",
	);
	const retired = questions.data?.questions.filter(
		(question) => question.state === "retired",
	);

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 text-sm text-foreground">
			<header className="flex flex-col gap-1">
				<h1 className="text-lg font-medium">Run questions</h1>
				<p className="text-muted-foreground">
					Yes/no questions agents can ask about runs, answered as the
					probability of yes. A new wording is a new question; earlier answers
					keep their wording. Test a question on 20 runs before turning it on.
				</p>
				<ul className="list-disc pl-5 text-muted-foreground">
					<li>Ask one yes/no question; split a compound condition in two.</li>
					<li>
						Phrase it so a high value means yes (not "Was the run free of
						errors?").
					</li>
					<li>Make the boundary between yes and no unambiguous.</li>
					<li>
						Add criteria when the boundary is subtle, and test with and without
						them.
					</li>
				</ul>
			</header>
			<AddQuestionForm
				onAdd={(question, criteria, label) =>
					act(() =>
						client.admin.runQuestions.add({
							question,
							...(criteria ? { criteria } : {}),
							...(label ? { label } : {}),
						}),
					)
				}
			/>
			{error ? (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			) : null}
			{questions.isError ? (
				<p role="alert" className="text-destructive">
					Couldn't load the run questions: {questions.error.message}
				</p>
			) : null}
			<ul className="flex flex-col gap-3" aria-label="Run questions">
				{live?.map((question) => (
					<QuestionRow
						key={question.id}
						question={question}
						onEdit={(wording, label) =>
							act(() =>
								client.admin.runQuestions.edit({
									id: question.id,
									question: wording,
									...(question.criteria ? { criteria: question.criteria } : {}),
									...(label ? { label } : {}),
								}),
							)
						}
						onRemove={() =>
							act(() => client.admin.runQuestions.remove({ id: question.id }))
						}
						onTurnOn={() =>
							act(() => client.admin.runQuestions.turnOn({ id: question.id }))
						}
						providers={questions.data?.providers ?? []}
						testing={testing === question.id}
						onToggleTest={() =>
							setTesting(testing === question.id ? null : question.id)
						}
						onError={setError}
					/>
				))}
				{live?.length === 0 ? (
					<li className="text-muted-foreground">No run questions yet.</li>
				) : null}
			</ul>
			{retired?.length ? (
				<details>
					<summary className="text-muted-foreground">
						Removed and reworded ({retired.length})
					</summary>
					<ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
						{retired.map((question) => (
							<li key={question.id}>
								{question.question} <code>{question.id}</code>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</main>
	);
}

function AddQuestionForm({
	onAdd,
}: {
	onAdd: (
		question: string,
		criteria: RunQuestionCriteria | null,
		label: string | null,
	) => Promise<boolean>;
}) {
	const [wording, setWording] = useState("");
	const [label, setLabel] = useState("");
	const [yes, setYes] = useState("");
	const [no, setNo] = useState("");
	// Criteria go with the question only when both sides are described.
	const criteria =
		yes.trim() && no.trim() ? { true: yes.trim(), false: no.trim() } : null;
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (await onAdd(wording, criteria, label.trim() || null)) {
			setWording("");
			setLabel("");
			setYes("");
			setNo("");
		}
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<div className="flex gap-2">
				<label className="sr-only" htmlFor="run-question-new">
					New run question
				</label>
				<input
					id="run-question-new"
					value={wording}
					onChange={(event) => setWording(event.target.value)}
					placeholder="Did the agent struggle to find the right file?"
					className="h-9 flex-1 rounded-md border bg-background px-3"
				/>
				<Button
					type="submit"
					disabled={
						wording.trim().length < 10 ||
						Boolean(yes.trim()) !== Boolean(no.trim()) ||
						(label.trim().length > 0 &&
							(label.trim().length < 2 ||
								label.trim().length > RUN_QUESTION_LABEL_MAX_CHARS))
					}
				>
					Add
				</Button>
			</div>
			<label className="flex flex-col gap-1 text-muted-foreground">
				Tag label (optional): the short name the dashboard shows, at most{" "}
				{RUN_QUESTION_LABEL_MAX_CHARS} characters
				<input
					value={label}
					onChange={(event) => setLabel(event.target.value)}
					placeholder="Hunted for files"
					maxLength={RUN_QUESTION_LABEL_MAX_CHARS}
					className="h-8 rounded-md border bg-background px-3 text-foreground"
				/>
			</label>
			<details>
				<summary className="text-muted-foreground">Criteria (optional)</summary>
				<div className="mt-2 flex flex-col gap-2">
					<label className="flex flex-col gap-1">
						A yes looks like
						<input
							value={yes}
							onChange={(event) => setYes(event.target.value)}
							className="h-8 rounded-md border bg-background px-3"
						/>
					</label>
					<label className="flex flex-col gap-1">
						A no looks like
						<input
							value={no}
							onChange={(event) => setNo(event.target.value)}
							className="h-8 rounded-md border bg-background px-3"
						/>
					</label>
				</div>
			</details>
		</form>
	);
}

function QuestionRow({
	question,
	onEdit,
	onRemove,
	onTurnOn,
	providers,
	testing,
	onToggleTest,
	onError,
}: {
	question: RunQuestion;
	/** A new wording makes a new question; the same wording with a new label changes it in place. */
	onEdit: (wording: string, label: string | null) => Promise<boolean>;
	onRemove: () => Promise<boolean>;
	onTurnOn: () => Promise<boolean>;
	providers: readonly string[];
	testing: boolean;
	onToggleTest: () => void;
	onError: (message: string) => void;
}) {
	const [editing, setEditing] = useState<{
		label: string;
		wording: string;
	} | null>(null);
	return (
		<li className="flex flex-col gap-2 rounded-md border p-3">
			{editing === null ? (
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<span>{question.question}</span>
						<span className="text-xs text-muted-foreground">
							Tag:{" "}
							{question.label ?? (
								<span className="italic">none, the wording cut short</span>
							)}
						</span>
						{question.criteria ? (
							<span className="text-xs text-muted-foreground">
								Yes: {question.criteria.true} · No: {question.criteria.false}
							</span>
						) : null}
						<span className="text-xs text-muted-foreground">
							<code>{question.id}</code> ·{" "}
							{question.state === "on" ? "On" : "Draft"} ·{" "}
							{question.testedPrecision !== null
								? `Precision ${question.testedPrecision.toFixed(2)} on ${question.testedRuns} runs${question.testedProvider ? ` (${question.testedProvider})` : ""}`
								: question.testedRuns
									? `No yes answers among ${question.testedRuns} judged runs`
									: "Untested"}
						</span>
					</div>
					<div className="flex shrink-0 gap-1">
						<Button size="sm" variant="outline" onClick={onToggleTest}>
							{testing ? "Close test" : "Test"}
						</Button>
						{question.state === "draft" ? (
							<Button size="sm" onClick={onTurnOn}>
								Turn on
							</Button>
						) : null}
						<Button
							size="sm"
							variant="ghost"
							onClick={() =>
								setEditing({
									label: question.label ?? "",
									wording: question.question,
								})
							}
						>
							Edit
						</Button>
						<Button size="sm" variant="ghost" onClick={onRemove}>
							Remove
						</Button>
					</div>
				</div>
			) : (
				<form
					className="flex flex-col gap-2"
					onSubmit={async (event) => {
						event.preventDefault();
						if (await onEdit(editing.wording, editing.label.trim() || null))
							setEditing(null);
					}}
				>
					<div className="flex gap-2">
						<label className="sr-only" htmlFor={`run-question-${question.id}`}>
							New wording
						</label>
						<input
							id={`run-question-${question.id}`}
							value={editing.wording}
							onChange={(event) =>
								setEditing({ ...editing, wording: event.target.value })
							}
							className="h-8 flex-1 rounded-md border bg-background px-3"
						/>
						<Button size="sm" type="submit">
							{editing.wording.trim() === question.question
								? "Save label"
								: "Save as new question"}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							type="button"
							onClick={() => setEditing(null)}
						>
							Cancel
						</Button>
					</div>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						Tag label
						<input
							aria-label="Tag label"
							value={editing.label}
							onChange={(event) =>
								setEditing({ ...editing, label: event.target.value })
							}
							maxLength={RUN_QUESTION_LABEL_MAX_CHARS}
							className="h-7 flex-1 rounded-md border bg-background px-2 text-foreground"
						/>
					</label>
				</form>
			)}
			{testing ? (
				<QuestionTest
					question={question}
					providers={providers}
					onError={onError}
				/>
			) : null}
		</li>
	);
}

function QuestionTest({
	question,
	providers,
	onError,
}: {
	question: RunQuestion;
	/** Configured providers, the default first. */
	providers: readonly string[];
	onError: (message: string) => void;
}) {
	const queryClient = useQueryClient();
	const {
		state: { organizations, activeOrg },
	} = useOrganization();
	const [chosen, setChosen] = useState<string | null>(null);
	// The active workspace until the operator picks one; it may load later.
	const workspaceId = chosen ?? activeOrg?.id ?? organizations[0]?.id ?? "";
	const [pickedProvider, setPickedProvider] = useState<string | null>(null);
	const provider = pickedProvider ?? providers[0] ?? "";
	const [verdicts, setVerdicts] = useState<Record<string, boolean>>({});
	const test = useQuery({
		queryKey: testKey(question.id, provider),
		queryFn: () =>
			client.admin.runQuestions.testResult({
				id: question.id,
				...(provider ? { provider } : {}),
			}),
		refetchInterval: (query) =>
			query.state.data?.status === "queued" ? TEST_POLL_MS : false,
	});
	const run = async (work: () => Promise<unknown>) => {
		try {
			await work();
			await queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
		} catch (failure) {
			onError(failure instanceof Error ? failure.message : String(failure));
		}
	};
	const runs = test.data?.runs ?? [];
	const judged = runs.filter((run) => verdictKey(run) in verdicts);
	return (
		<section className="flex flex-col gap-2 border-t pt-2" aria-label="Test">
			<div className="flex items-center gap-2">
				<label htmlFor={`run-question-test-${question.id}`}>
					Test on the newest 20 runs of
				</label>
				<select
					id={`run-question-test-${question.id}`}
					value={workspaceId}
					onChange={(event) => setChosen(event.target.value)}
					className="h-8 rounded-md border bg-background px-2"
				>
					{organizations.map((organization) => (
						<option key={organization.id} value={organization.id}>
							{organization.name}
						</option>
					))}
				</select>
				{providers.length ? (
					<>
						<label htmlFor={`run-question-provider-${question.id}`}>
							Answered by
						</label>
						<select
							id={`run-question-provider-${question.id}`}
							value={provider}
							onChange={(event) => {
								setVerdicts({});
								setPickedProvider(event.target.value);
							}}
							className="h-8 rounded-md border bg-background px-2"
						>
							{providers.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
					</>
				) : null}
				<Button
					size="sm"
					disabled={!workspaceId}
					onClick={() =>
						run(async () => {
							setVerdicts({});
							queryClient.setQueryData(
								testKey(question.id, provider),
								await client.admin.runQuestions.test({
									id: question.id,
									workspaceId,
									...(provider ? { provider } : {}),
								}),
							);
						})
					}
				>
					Run test
				</Button>
			</div>
			<TestStatus test={test.data} />
			{runs.length ? (
				<table className="w-full text-left">
					<thead className="text-xs text-muted-foreground">
						<tr>
							<th className="py-1 font-normal">Prompt</th>
							<th className="py-1 font-normal">Yes</th>
							<th className="py-1 font-normal">Your verdict</th>
						</tr>
					</thead>
					<tbody>
						{runs.map((run) => (
							<tr key={verdictKey(run)} className="border-t align-top">
								<td className="py-1 pr-2">{run.promptHead || run.sessionId}</td>
								<td className="py-1 pr-2 tabular-nums">
									{run.probability === null ? "…" : run.probability.toFixed(2)}
								</td>
								<td className="py-1">
									<fieldset className="flex gap-1">
										<legend className="sr-only">
											Is the answer yes for {run.promptHead || run.sessionId}?
										</legend>
										{[true, false].map((yes) => (
											<Button
												key={String(yes)}
												size="xs"
												variant={
													verdicts[verdictKey(run)] === yes
														? "default"
														: "outline"
												}
												aria-pressed={verdicts[verdictKey(run)] === yes}
												onClick={() =>
													setVerdicts({ ...verdicts, [verdictKey(run)]: yes })
												}
											>
												{yes ? "Yes" : "No"}
											</Button>
										))}
									</fieldset>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
			{judged.length ? (
				<Button
					size="sm"
					className="self-start"
					onClick={() =>
						run(() =>
							client.admin.runQuestions.recordVerdicts({
								id: question.id,
								...(provider ? { provider } : {}),
								verdicts: judged.map((item) => ({
									sessionId: item.sessionId,
									agentId: item.agentId,
									turn: item.turn,
									yes: verdicts[verdictKey(item)] ?? false,
								})),
							}),
						)
					}
				>
					Save {judged.length} verdicts
				</Button>
			) : null}
		</section>
	);
}

function TestStatus({ test }: { test: RunQuestionTest | undefined }) {
	if (!test || test.status === "none")
		return <p className="text-muted-foreground">Not tested yet.</p>;
	if (test.status === "queued")
		return (
			<p className="text-muted-foreground">
				Answering… results appear within a few minutes.
			</p>
		);
	if (test.status === "failed")
		return (
			<p role="alert" className="text-destructive">
				The test failed after its retries; run it again.
			</p>
		);
	return (
		<p className="text-muted-foreground">
			Answered. Mark each run's true answer to measure precision.
		</p>
	);
}

function verdictKey(run: {
	sessionId: string;
	agentId: string;
	turn: number;
}): string {
	return JSON.stringify([run.sessionId, run.agentId, run.turn]);
}
