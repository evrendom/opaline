export class UsageExtractionSupersededError extends Error {
	constructor() {
		super(
			"Usage extraction was superseded before its receipt was confirmed; retry the upload",
		);
		this.name = "UsageExtractionSupersededError";
	}
}
