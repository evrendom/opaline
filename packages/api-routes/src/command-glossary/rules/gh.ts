import { code, list, text } from "../sentence.js";
import {
	explains,
	has,
	positionals,
	type RuleContext,
	type RuleResult,
	subcommandPath,
	values,
} from "./context.js";

/** `gh api`: the endpoint, the method (GET, or POST once fields are sent,
 * as gh does), the fields set, and what `--jq` picks. Read from the words as
 * written: Fig's spec doesn't list every flag gh api takes. */
function ghApi(context: RuleContext): RuleResult {
	const takesValue = new Set([
		"-X",
		"--method",
		"-f",
		"--raw-field",
		"-F",
		"--field",
		"-H",
		"--header",
		"-q",
		"--jq",
		"-t",
		"--template",
		"--input",
		"-p",
		"--preview",
		"--cache",
		"--hostname",
	]);
	const words = context.args.slice(context.args.indexOf("api") + 1);
	let endpoint = "";
	for (let i = 0; i < words.length; i++) {
		const word = words[i] ?? "";
		if (takesValue.has(word)) {
			i++;
			continue;
		}
		if (!word.startsWith("-")) {
			endpoint = word;
			break;
		}
	}
	const fields = values(context, "-f", "--raw-field", "-F", "--field").map(
		(field) => field.split("=")[0] ?? field,
	);
	const method = (
		values(context, "-X", "--method")[0] ?? (fields.length > 0 ? "POST" : "GET")
	).toUpperCase();
	const pick = values(context, "-q", "--jq")[0];
	const pages = has(context, "--paginate");
	explains(context, "-H", "--header", "--input", "-i", "--include", "--silent");
	const graphql = endpoint === "graphql";
	return {
		sentence: [
			...(graphql
				? [text("Run a GraphQL query on the GitHub API")]
				: method === "GET"
					? [text("Read "), code(endpoint), text(" from the GitHub API")]
					: method === "DELETE"
						? [text("Delete "), code(endpoint), text(" on GitHub")]
						: [
								text(`Send a ${method} to `),
								code(endpoint),
								text(" on the GitHub API"),
							]),
			...(fields.length > 0 && !graphql
				? [text(", setting "), ...list(fields.map(code))]
				: []),
			...(pages ? [text(", every page")] : []),
			...(pick ? [text(", picking "), code(pick)] : []),
		],
		title: method === "GET" || graphql ? "GitHub API" : "Change on GitHub",
	};
}

export function gh(context: RuleContext): RuleResult | null {
	const result = ghCommand(context);
	if (!result) return null;
	const repo = values(context, "-R", "--repo")[0];
	const pick = values(context, "-q", "--jq")[0];
	explains(context, "--json");
	return {
		...result,
		sentence: [
			...result.sentence,
			...(repo ? [text(" in "), code(repo)] : []),
			...(pick &&
			result.title !== "GitHub API" &&
			result.title !== "Change on GitHub"
				? [text(", picking "), code(pick)]
				: []),
		],
	};
}

function ghCommand(context: RuleContext): RuleResult | null {
	const path = subcommandPath(context);
	const args = positionals(context);
	const pr = args[0]
		? [text("pull request "), code(`#${args[0].replace(/^#/u, "")}`)]
		: [text("the pull request of this branch")];
	switch (path.join(" ")) {
		case "pr view":
			return { sentence: [text("Look at "), ...pr], title: "Look at a PR" };
		case "pr checks":
			return {
				sentence: [
					text("Check the CI of "),
					...pr,
					...(has(context, "--watch")
						? [text(" and wait for it to finish")]
						: []),
				],
				title: "Check CI",
			};
		case "pr create":
			return {
				sentence: [
					text("Open a pull request"),
					...(values(context, "--title", "-t")[0]
						? [
								text(" titled "),
								{ term: values(context, "--title", "-t")[0] ?? "" },
							]
						: []),
				],
				title: "Open a PR",
			};
		case "pr merge":
			return { sentence: [text("Merge "), ...pr], title: "Merge a PR" };
		case "pr list": {
			const state = values(context, "-s", "--state")[0];
			const head = values(context, "-H", "--head")[0];
			const base = values(context, "-B", "--base")[0];
			const author = values(context, "-A", "--author")[0];
			const search = values(context, "-S", "--search")[0];
			const limit = values(context, "-L", "--limit")[0];
			return {
				sentence: [
					text(
						`List ${state === "all" ? "all the" : state ? `the ${state}` : "the open"} pull requests`,
					),
					...(head ? [text(" from "), code(head)] : []),
					...(base ? [text(" into "), code(base)] : []),
					...(author ? [text(" by "), code(author)] : []),
					...(search ? [text(" matching "), { term: search }] : []),
					...(limit ? [text(`, at most ${limit}`)] : []),
				],
				title: "List PRs",
			};
		}
		case "pr diff":
			return {
				sentence: [text("Show the changes in "), ...pr],
				title: "Show a PR's changes",
			};
		case "pr edit":
			return { sentence: [text("Edit "), ...pr], title: "Edit a PR" };
		case "run view": {
			const job = values(context, "-j", "--job")[0];
			const logs = has(context, "--log-failed")
				? [text(", the logs of its failed steps")]
				: has(context, "--log")
					? [text(", its logs")]
					: [];
			return {
				sentence: [
					...(job
						? [text("Look at job "), code(job)]
						: args[0]
							? [text("Look at CI run "), code(args[0])]
							: [text("Look at a CI run")]),
					...logs,
				],
				title: "Look at a CI run",
			};
		}
		case "run watch":
			return {
				sentence: [
					text("Wait for CI run "),
					code(args[0] ?? ""),
					text(" to finish"),
				],
				title: "Wait for CI",
			};
		case "run list": {
			const workflow = values(context, "-w", "--workflow")[0];
			const branch = values(context, "-b", "--branch")[0];
			const limit = values(context, "-L", "--limit")[0];
			return {
				sentence: [
					text(
						limit === "1"
							? "Find the latest CI run"
							: limit
								? `List the last ${limit} CI runs`
								: "List the recent CI runs",
					),
					...(workflow ? [text(" of "), code(workflow)] : []),
					...(branch ? [text(" on "), code(branch)] : []),
				],
				title: "List CI runs",
			};
		}
		case "api":
			return ghApi(context);
		default:
			return null;
	}
}
