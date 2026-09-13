export interface PreparedCliCommand {
	command: string;
}

export async function copyCliCommand(
	prepared: Promise<PreparedCliCommand | null>,
	immediate: PreparedCliCommand | null,
): Promise<boolean> {
	try {
		if (immediate && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(immediate.command);
		} else if (
			typeof ClipboardItem !== "undefined" &&
			navigator.clipboard?.write
		) {
			// Start the write within the click, retaining Safari's user activation
			// while pairing is prepared. Never write an unpaired command on failure.
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/plain": prepared.then((result) => {
						if (!result) throw new Error("Connection code unavailable");
						return new Blob([result.command], { type: "text/plain" });
					}),
				}),
			]);
		} else {
			const result = await prepared;
			if (!result) return false;
			if (!navigator.clipboard?.writeText)
				throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(result.command);
		}
		return true;
	} catch {
		// The browser owns clipboard permissions. Only confirm a successful write.
		return false;
	}
}
