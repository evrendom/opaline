import { ORPCError } from "@orpc/server";
import {
	describeSqlFailure,
	type SqlFailure,
} from "../../services/analysis/sql-gateway.js";

/** Recoverable refusals are bad requests; fatal ones are forbidden. Both carry the class. */
export function sqlError(failure: SqlFailure): ORPCError<string, unknown> {
	return new ORPCError(failure.kind === "fatal" ? "FORBIDDEN" : "BAD_REQUEST", {
		message: describeSqlFailure(failure),
		data: {
			kind: failure.kind,
			fragment: failure.fragment,
			fix: failure.fix,
		},
	});
}
