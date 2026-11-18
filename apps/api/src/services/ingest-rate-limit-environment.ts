import { sqlClient } from "../db.js";
import {
	createPostgresIngestRateLimitEnvironment,
	type IngestRateLimitEnvironment,
} from "./ingest-rate-limit.service.js";

let environment: IngestRateLimitEnvironment | undefined;

export function ingestRateLimitEnvironment(): IngestRateLimitEnvironment {
	environment ??= createPostgresIngestRateLimitEnvironment(sqlClient);
	return environment;
}

export function setIngestRateLimitEnvironmentForTests(
	replacement: IngestRateLimitEnvironment,
): void {
	if (process.env.NODE_ENV !== "test") {
		throw new Error(
			"The ingest rate-limit environment can only change in tests",
		);
	}
	environment = replacement;
}
