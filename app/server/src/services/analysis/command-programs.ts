import {
	argv0OfStartSql,
	FAMILY_HEREDOC,
	FAMILY_QUOTED,
	FAMILY_SKIPPED,
	FAMILY_SPLIT,
	lit,
	prefixOfStartSql,
	programStartSql,
	unwrapSql,
} from "./command-identity.js";

export function commandProgramColumnsSql(): string {
	const list = (values: readonly string[]) => `[${values.map(lit).join(", ")}]`;
	const text = `replaceRegexpOne(${unwrapSql("ifNull(command_text, '')")}, ${lit(FAMILY_HEREDOC)}, '')`;
	const quoted = `replaceRegexpAll(replaceRegexpAll(${text}, ${lit(FAMILY_QUOTED)}, ${lit("'Q'")}), '[(){}]', ' ')`;
	const statements = `splitByRegexp(${lit(FAMILY_SPLIT)}, ${quoted})`;
	const skipped = `arrayMap(t -> (t, ${argv0OfStartSql("t")}), arrayMap(s -> ${programStartSql("trimLeft(s)")}, ${statements}))`;
	return `if(command_from = 'command' AND command_text IS NOT NULL,
			arrayFilter(p -> p.2 != '' AND NOT has(${list(FAMILY_SKIPPED)}, p.2), ${skipped}),
			[]) AS command_program_starts,
		arrayDistinct(arrayMap(p -> p.2, command_program_starts)) AS command_programs,
		arrayDistinct(arrayMap(p -> ${prefixOfStartSql("p.1", "p.2")}, command_program_starts)) AS command_prefixes`;
}

export const FILES_READ_SQL = `multiIf(
			facts['files_read'] != '', JSONExtract(facts['files_read'], 'Array(String)'),
			facts['shell_read_paths'] != '', JSONExtract(facts['shell_read_paths'], 'Array(String)'),
			kind = 'tool_call' AND file_op = 'read' AND file_path != '', [file_path],
			CAST([], 'Array(String)'))`;

export const COMMAND_CLASSES_SQL = `if(facts['command_classes'] != '',
			JSONExtract(facts['command_classes'], 'Array(String)'),
			if(command_class != '', [toString(command_class)], CAST([], 'Array(String)')))`;
