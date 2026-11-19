import { explainCommand } from "@rudel/api-routes/command-glossary";
import { queryOptions } from "@tanstack/react-query";

export function explainCommandQuery(command: string) {
	return queryOptions({
		gcTime: 5 * 60_000,
		queryFn: () => explainCommand(command),
		queryKey: ["explain-command", command] as const,
		staleTime: Number.POSITIVE_INFINITY,
	});
}
