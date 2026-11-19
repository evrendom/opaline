/**
 * Raised by the deletion fence (`assertNoClickHousePurgeTombstone`) when a
 * writer finds that its account or organization is being deleted. It lives
 * apart from the Postgres-backed check so writers and their callers can
 * recognize it without importing a database client.
 */
export class ClickHouseWriteFencedError extends Error {
	constructor() {
		super("Writes are fenced: the account or organization is being deleted");
		this.name = "ClickHouseWriteFencedError";
	}
}
