import { code, file, files, list, type Segment, text } from "../sentence.js";
import {
	explains,
	has,
	lineCount,
	positionals,
	type RuleContext,
	type RuleResult,
	subcommandPath,
	values,
} from "./context.js";
import { grep } from "./text.js";

const GREP_VALUE_FLAGS: Record<string, string> = {
	"-A": "--after-context",
	"-B": "--before-context",
	"-C": "--context",
	"-e": "--regexp",
	"-m": "--max-count",
};

/**
 * `git grep` read by the grep rule: Fig's git spec doesn't list grep's
 * options, so the words as written are put the way grep's rule reads them
 * (`-A 25` as `--after-context=25`, `':!*.png'` as `--exclude=*.png`).
 */
function gitGrep(context: RuleContext): Segment[] {
	const after = context.args.slice(context.args.indexOf("grep") + 1);
	const args: string[] = [];
	let pathsFrom = false;
	for (let i = 0; i < after.length; i++) {
		const word = after[i] ?? "";
		if (word === "--") {
			pathsFrom = true;
			continue;
		}
		if (pathsFrom || !word.startsWith("-")) {
			const excluded = /^:(?:!|\^|\(exclude\))(.*)$/u.exec(word);
			args.push(excluded ? `--exclude=${excluded[1]}` : word);
			continue;
		}
		const short = word.slice(0, 2);
		const long = GREP_VALUE_FLAGS[short];
		if (long) {
			const value = word.length > 2 ? word.slice(2) : after[++i];
			args.push(`${long}=${value ?? ""}`);
			continue;
		}
		args.push(word);
	}
	const searched = args.filter((arg) => !arg.startsWith("-"));
	const patternGiven = args.some((arg) => arg.startsWith("--regexp="));
	const noPath = searched.length <= (patternGiven ? 0 : 1);
	return grep({
		...context,
		args: noPath ? [...args, "-r"] : args,
		parsed: null,
		program: "grep",
	}).sentence.map((segment) =>
		"text" in segment && segment.text === " in every file under this folder"
			? text(" in every tracked file under this folder")
			: segment,
	);
}

const DIFF_FILTER: Record<string, string> = {
	a: "added",
	c: "copied",
	d: "deleted",
	m: "modified",
	r: "renamed",
	t: "retyped",
	u: "conflicted",
};

function gitDiff(
	context: RuleContext,
	args: string[],
	say: (title: string, ...sentence: Segment[]) => RuleResult,
): RuleResult {
	const end = context.args.indexOf("--");
	const paths =
		end >= 0
			? context.args.slice(end + 1)
			: args.filter(
					(arg) => /\.[A-Za-z][\w-]*$/u.test(arg) && !arg.includes(".."),
				);
	const refs = args.filter((arg) => !paths.includes(arg));
	const staged = has(context, "--cached", "--staged");
	const verb = has(context, "--quiet", "--exit-code")
		? "Check whether anything changed"
		: has(context, "--stat")
			? "Summarise the changes"
			: has(context, "--name-only")
				? "List the changed files"
				: has(context, "--name-status")
					? "List the changed files and how each changed"
					: staged
						? "Show the staged changes"
						: "Show the changes";
	const [first = "", second] = refs;
	const range = /^(.*?)(\.{2,3})(.*)$/u.exec(first);
	const between: Segment[] =
		refs.length > 2
			? [text(" in "), ...list(refs.map(code))]
			: range && refs.length === 1
				? range[2] === "..."
					? [
							text(" made on "),
							code(range[3] || "HEAD"),
							text(" since it branched from "),
							code(range[1] || "HEAD"),
						]
					: [
							text(" between "),
							code(range[1] || "HEAD"),
							text(" and "),
							code(range[3] || "HEAD"),
						]
				: second
					? [text(" between "), code(first), text(" and "), code(second)]
					: first
						? [text(" since "), code(first)]
						: [];
	const filter = values(context, "--diff-filter")[0] ?? "";
	const kinds = (pick: (char: string) => boolean) =>
		[...filter].filter(pick).flatMap((char) => {
			const name = DIFF_FILTER[char.toLowerCase()];
			return name ? [name] : [];
		});
	const only = kinds((char) => char !== char.toLowerCase());
	const without = kinds((char) => char === char.toLowerCase());
	const join = (names: string[]) =>
		names.length > 1
			? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
			: (names[0] ?? "");
	return say(
		"Show changes",
		text(verb),
		...(staged && verb !== "Show the staged changes"
			? [text(", staged only")]
			: []),
		...(paths.length > 0 ? [text(" in "), ...files(paths)] : []),
		...between,
		...(only.length > 0 ? [text(`, only the ${join(only)} ones`)] : []),
		...(without.length > 0
			? [text(`, leaving out the ${join(without)} ones`)]
			: []),
	);
}

export function git(context: RuleContext): RuleResult | null {
	const path = subcommandPath(context);
	const bare = path.length === 0 ? positionals(context)[0] : undefined;
	const [sub = bare ?? "", ...rest] = path;
	const args = bare ? positionals(context).slice(1) : positionals(context);
	const message = values(context, "-m", "--message")[0];
	const where = values(context, "-C")[0];
	const at: Segment[] = where ? [text(" in "), file(where)] : [];
	const say = (title: string, ...sentence: Segment[]): RuleResult => ({
		sentence: [...sentence, ...at],
		title,
	});
	switch (sub) {
		case "status":
			return say("See what changed", text("See which files changed"));
		case "add":
			return say(
				"Stage",
				text("Stage "),
				...(has(context, "-A", "--all") || args.includes(".")
					? [text("every change")]
					: files(args)),
			);
		case "commit":
			return say(
				"Commit",
				text(
					has(context, "--amend")
						? "Fold the staged changes into the last commit"
						: "Commit the staged changes",
				),
				...(message
					? [
							text(" with the message "),
							{ term: message.split("\n")[0] ?? message },
						]
					: []),
				...(has(context, "-a", "--all")
					? [text(", every tracked change included")]
					: []),
			);
		case "push":
			return say(
				"Push",
				text(
					has(context, "-f", "--force", "--force-with-lease")
						? "Force-push "
						: "Push ",
				),
				...(args.length > 1
					? [code(args.slice(1).join(" ")), text(" to "), code(args[0] ?? "")]
					: args.length === 1
						? [text("to "), code(args[0] ?? "")]
						: [text("the current branch")]),
			);
		case "pull":
			return say("Pull", text("Bring in the latest commits from the remote"));
		case "fetch":
			return say(
				"Fetch",
				text("Download the latest from "),
				code(args[0] ?? "the remote"),
				text(", without touching your branches or files"),
			);
		case "checkout":
		case "switch":
			if (context.args.includes("--"))
				return say(
					"Restore",
					text("Throw away the changes to "),
					...files(args),
				);
			return say(
				"Switch branch",
				text(
					has(context, "-b", "-B", "-c", "--create")
						? "Create and switch to the branch "
						: "Switch to ",
				),
				code(values(context, "-b", "-B", "-c")[0] ?? args[0] ?? ""),
			);
		case "merge":
			return say(
				"Merge",
				text("Merge "),
				code(args[0] ?? ""),
				text(" into the current branch"),
				...(has(context, "--no-commit")
					? [text(", without committing yet")]
					: []),
			);
		case "rebase":
			return say(
				"Rebase",
				text("Replay the current branch on top of "),
				code(args[0] ?? ""),
			);
		case "log": {
			const limit = lineCount(context, 0);
			const refs = args.filter((arg) => !/^-\d+$/u.test(arg));
			return say(
				"Show history",
				text(
					limit === 1
						? "Show the latest commit"
						: limit > 1
							? `Show the last ${limit} commits`
							: "Show the history",
				),
				...(refs.length > 0 ? [text(" of "), ...list(refs.map(code))] : []),
				...(has(context, "--oneline") ? [text(", one line each")] : []),
			);
		}
		case "diff":
			return gitDiff(context, args, say);
		case "ls-tree": {
			const [rev = "HEAD", ...paths] = args;
			explains(context, "--name-only", "--name-status");
			return say(
				"List files",
				text("List the files of "),
				code(rev),
				...(paths.length > 0 ? [text(" under "), ...files(paths)] : []),
				...(has(context, "-r") ? [text(", every subfolder included")] : []),
			);
		}
		case "show": {
			const [object = "HEAD"] = args;
			const [rev, path] = object.split(":");
			return path
				? say(
						"Show a file",
						text("Show "),
						file(path),
						text(" as it was at "),
						code(rev ?? ""),
					)
				: say("Show a commit", text("Show the commit "), code(object));
		}
		case "stash":
			return say(
				"Stash",
				text(
					rest[0] === "pop"
						? "Bring back the stashed changes"
						: "Put the changes aside",
				),
			);
		case "reset":
			return say(
				"Reset",
				text(
					has(context, "--hard")
						? "Throw away every change and go back to "
						: "Move the branch back to ",
				),
				code(args[0] ?? "HEAD"),
			);
		case "restore":
			return say("Restore", text("Throw away the changes to "), ...files(args));
		case "worktree":
			if (rest[0] === "add")
				return say(
					"Add a worktree",
					text("Make a separate checkout at "),
					file(args[0] ?? ""),
					...(args[1] ? [text(" on "), code(args[1])] : []),
				);
			return null;
		case "rev-parse":
			return say("Look up", text("Look up "), ...args.map(code));
		case "blame":
			return say(
				"Blame",
				text("Show who last changed each line of "),
				...files(args),
			);
		case "grep":
			return {
				...say("Search the repo", ...gitGrep(context)),
				title: "Search the repo",
			};
		case "merge-base":
			return say(
				"Find a base",
				text("Find the commit where "),
				code(args[0] ?? ""),
				text(" and "),
				code(args[1] ?? "HEAD"),
				text(" branched apart"),
			);
		case "ls-files": {
			const untracked = has(context, "-o", "--others");
			const ignored = has(context, "--exclude-standard");
			return say(
				"List files",
				text(untracked ? "List the untracked files" : "List the tracked files"),
				...(args.length > 0 ? [text(" under "), ...files(args)] : []),
				...(untracked && ignored ? [text(", ignored ones left out")] : []),
			);
		}
		case "branch":
			if (has(context, "--show-current"))
				return say("Branch", text("Show the current branch's name"));
			if (has(context, "-d", "-D", "--delete"))
				return say(
					"Delete a branch",
					text("Delete the branch "),
					...list(args.map(code)),
				);
			return args[0]
				? say("Create a branch", text("Create the branch "), code(args[0]))
				: say("List branches", text("List the branches"));
		default:
			return null;
	}
}
