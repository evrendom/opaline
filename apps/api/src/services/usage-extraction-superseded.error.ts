export class UsageExtractionSupersededError extends Error {
	constructor() {
		super("Usage extraction was superseded by a newer raw session revision");
		this.name = "UsageExtractionSupersededError";
	}
}
