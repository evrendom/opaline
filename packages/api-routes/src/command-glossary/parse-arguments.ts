// Adapted from Fig's `parseArguments.ts` (aws/amazon-q-developer-cli-autocomplete,
// packages/autocomplete-parser/src/parseArguments.ts; Apache License 2.0, see
// LICENSE-APACHE-2.0 here). The state machine — the order in which a word is
// tried as a subcommand, an option (single, chained `-cve`, or `--x=y`), an
// option's argument or the subcommand's argument, the argument states with
// their variadic and optional rules, `--`, persistent options and parser
// directives — is Fig's. Changed: it reads the slim specs in ./fig-spec.ts
// instead of Fig's internal ones, has no generators, caches or suggestion
// state, keeps each word's description for explanations, and stops at an
// argument that is a command of its own (`sudo`, `xargs`), returning where
// that command starts instead of loading its spec.

import type { FigArg, FigOption, FigSpec } from "./fig-spec.js";

export type WordAnnotation =
	| { kind: "subcommand"; text: string; spec: FigSpec }
	| { kind: "option"; text: string; flag: string; option: FigOption }
	| {
			kind: "option_arg";
			text: string;
			arg: FigArg | null;
			option: FigOption | null;
	  }
	| { kind: "argument"; text: string; arg: FigArg | null }
	| { kind: "end_of_options"; text: string };

export type ParsedCommand = {
	words: WordAnnotation[];
	subcommands: FigSpec[];
	nestedCommandAt: number | null;
	unknownAt: number | null;
};

type ArgState = {
	args: FigArg[] | null;
	index: number;
	variadicCount?: number;
};

type Internal = {
	spec: FigSpec;
	subcommands: Map<string, FigSpec>;
	options: Map<string, FigOption>;
	persistentOptions: Map<string, FigOption>;
	directives: NonNullable<FigSpec["pd"]>;
};

type State = {
	command: Internal;
	optionArgState: ArgState;
	subcommandArgState: ArgState;
	annotations: WordAnnotation[];
	subcommands: FigSpec[];
	currentOption: FigOption | null;
	haveEnteredSubcommandArgs: boolean;
	isEndOfOptions: boolean;
};

class UpdateStateError extends Error {}

function internal(spec: FigSpec, inherited?: Internal): Internal {
	const subcommands = new Map<string, FigSpec>();
	for (const sub of spec.s ?? [])
		for (const name of sub.n) subcommands.set(name, sub);
	const options = new Map<string, FigOption>();
	const persistentOptions = new Map(inherited?.persistentOptions);
	for (const option of spec.o ?? [])
		for (const name of option.n) {
			options.set(name, option);
			if (option.p) persistentOptions.set(name, option);
		}
	return {
		directives: spec.pd ?? inherited?.directives ?? {},
		options,
		persistentOptions,
		spec,
		subcommands,
	};
}

const createArgState = (args?: FigArg[]): ArgState => ({
	args: args && args.length > 0 ? args : null,
	index: 0,
});

const updateArgState = ({ args, index, variadicCount }: ArgState): ArgState => {
	if (args?.[index]?.v)
		return { args, index, variadicCount: (variadicCount ?? 0) + 1 };
	if (args?.[index] && index < args.length - 1)
		return { args, index: index + 1 };
	return { args: null, index: 0 };
};

const currentArg = (state: ArgState): FigArg | null =>
	state.args?.[state.index] ?? null;

const isMandatoryOrVariadic = (arg: FigArg | null) =>
	!!arg && (!!arg.v || !arg.o);

const preferOptionArg = (state: State) =>
	isMandatoryOrVariadic(currentArg(state.optionArgState)) ||
	!currentArg(state.subcommandArgState);

function canConsumeOptions(state: State): boolean {
	const { subcommandArgState, optionArgState, isEndOfOptions } = state;
	if (state.haveEnteredSubcommandArgs && state.command.directives.first)
		return false;
	if (isEndOfOptions) return false;
	const subcommandArg = currentArg(subcommandArgState);
	const optionArg = currentArg(optionArgState);
	if (isMandatoryOrVariadic(optionArg)) {
		return !!(optionArg?.v && optionArgState.variadicCount && !optionArg.nb);
	}
	if (subcommandArg && subcommandArgState.variadicCount && subcommandArg.nb)
		return false;
	return true;
}

function findOption(command: Internal, token: string): FigOption {
	const option =
		command.options.get(token) ?? command.persistentOptions.get(token);
	if (!option) throw new UpdateStateError(`Option not found: ${token}`);
	return option;
}

function updateStateForSubcommand(state: State, token: string): State {
	if (state.command.subcommands.size === 0)
		throw new UpdateStateError("No subcommands");
	if (state.haveEnteredSubcommandArgs)
		throw new UpdateStateError("Already in args");
	const spec = state.command.subcommands.get(token);
	if (!spec) throw new UpdateStateError("Subcommand not found");
	const command = internal(spec, state.command);
	return {
		...state,
		annotations: [
			...state.annotations,
			{ kind: "subcommand", spec, text: token },
		],
		command,
		currentOption: null,
		optionArgState: createArgState(),
		subcommandArgState: createArgState(spec.a),
		subcommands: [...state.subcommands, spec],
	};
}

function updateStateForOption(
	state: State,
	token: string,
	text = token,
): State {
	const option = findOption(state.command, token);
	return {
		...state,
		annotations: [
			...state.annotations,
			{ flag: token, kind: "option", option, text },
		],
		currentOption: option,
		optionArgState: createArgState(option.a),
	};
}

function updateStateForOptionArg(state: State, token: string): State {
	const arg = currentArg(state.optionArgState);
	if (!arg) throw new UpdateStateError("Cannot consume option arg.");
	return {
		...state,
		annotations: [
			...state.annotations,
			{ arg, kind: "option_arg", option: state.currentOption, text: token },
		],
		optionArgState: updateArgState(state.optionArgState),
	};
}

function updateStateForSubcommandArg(state: State, token: string): State {
	const arg = currentArg(state.subcommandArgState);
	if (!arg) throw new UpdateStateError("Cannot consume subcommand arg.");
	return {
		...state,
		annotations: [...state.annotations, { arg, kind: "argument", text: token }],
		haveEnteredSubcommandArgs: true,
		subcommandArgState: updateArgState(state.subcommandArgState),
	};
}

function firstSeparator(
	token: string,
	separators: readonly string[],
): string | null {
	let found: { at: number; separator: string } | null = null;
	for (const separator of separators) {
		const at = token.indexOf(separator);
		if (at > 0 && (!found || at < found.at)) found = { at, separator };
	}
	return found?.separator ?? null;
}

function updateStateForChainedOptionToken(state: State, token: string): State {
	if (token === "--")
		return {
			...state,
			annotations: [
				...state.annotations,
				{ kind: "end_of_options", text: token },
			],
			isEndOfOptions: true,
			optionArgState: { args: null, index: 0 },
		};
	const { directives } = state.command;
	const isLongOption =
		!!directives.np || token.startsWith("--") || !token.startsWith("-");
	if (isLongOption) {
		const separator = firstSeparator(token, directives.sep ?? ["="]);
		if (separator) {
			const [flag = "", ...rest] = token.split(separator);
			const optionState = updateStateForOption(
				state,
				flag,
				`${flag}${separator}`,
			);
			if ((optionState.optionArgState.args?.length ?? 0) > 1)
				throw new UpdateStateError("Option takes multiple args");
			return updateStateForOptionArg(optionState, rest.join(separator));
		}
		const next = updateStateForOption(state, token);
		const option = findOption(state.command, token);
		return option.s
			? { ...next, optionArgState: { args: null, index: 0 } }
			: next;
	}
	let optionState = state;
	let optionArg = "";
	for (let i = 1; i < token.length; i += 1) {
		const flag = `-${token[i]}`;
		try {
			optionState = updateStateForOption(
				optionState,
				flag,
				i === 1 ? flag : (token[i] ?? ""),
			);
		} catch (error) {
			if (i > 1) {
				optionArg = token.slice(i);
				break;
			}
			throw error;
		}
		if (isMandatoryOrVariadic(currentArg(optionState.optionArgState))) {
			optionArg = token.slice(i + 1);
			break;
		}
	}
	if (optionArg) {
		if ((optionState.optionArgState.args?.length ?? 0) > 1)
			throw new UpdateStateError("Cannot chain option argument");
		optionState = updateStateForOptionArg(optionState, optionArg);
	}
	return optionState;
}

const canConsumeSubcommands = (state: State) =>
	!isMandatoryOrVariadic(currentArg(state.optionArgState)) &&
	!state.haveEnteredSubcommandArgs;

function updateState(state: State, token: string): State {
	if (canConsumeSubcommands(state)) {
		try {
			return updateStateForSubcommand(state, token);
		} catch {}
	}
	if (canConsumeOptions(state)) {
		try {
			return updateStateForChainedOptionToken(state, token);
		} catch {}
	}
	if (preferOptionArg(state)) {
		try {
			return updateStateForOptionArg(state, token);
		} catch {}
	}
	if (!state.command.spec.a && !currentArg(state.subcommandArgState))
		return {
			...state,
			annotations: [
				...state.annotations,
				{ arg: null, kind: "argument", text: token },
			],
			haveEnteredSubcommandArgs: true,
		};
	return updateStateForSubcommandArg(state, token);
}

export function parseArguments(
	spec: FigSpec,
	words: readonly string[],
): ParsedCommand {
	const root = internal(spec);
	let state: State = {
		annotations: [],
		command: root,
		currentOption: null,
		haveEnteredSubcommandArgs: false,
		isEndOfOptions: false,
		optionArgState: createArgState(),
		subcommandArgState: createArgState(spec.a),
		subcommands: [spec],
	};
	for (const [index, word] of words.entries()) {
		const pending = preferOptionArg(state)
			? currentArg(state.optionArgState)
			: currentArg(state.subcommandArgState);
		if (pending?.c && !word.startsWith("-"))
			return {
				nestedCommandAt: index,
				subcommands: state.subcommands,
				unknownAt: null,
				words: state.annotations,
			};
		if (pending?.c) {
			try {
				state = updateStateForChainedOptionToken(state, word);
			} catch {
				state = {
					...state,
					annotations: [
						...state.annotations,
						{ arg: null, kind: "argument", text: word },
					],
				};
			}
			continue;
		}
		try {
			state = updateState(state, word);
		} catch {
			return {
				nestedCommandAt: null,
				subcommands: state.subcommands,
				unknownAt: index,
				words: [
					...state.annotations,
					...words
						.slice(index)
						.map(
							(text): WordAnnotation => ({ arg: null, kind: "argument", text }),
						),
				],
			};
		}
	}
	return {
		nestedCommandAt: null,
		subcommands: state.subcommands,
		unknownAt: null,
		words: state.annotations,
	};
}
