let inline = false;

export function runIngestWorkInline(): void {
	inline = true;
}

export function ingestWorkRunsInline(): boolean {
	return inline;
}
