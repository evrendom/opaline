import { isRecord } from "./line-items.js";

export function codexForkParentIds(content: string): string[] {
	const parents = new Set<string>();
	let start = 0;
	while (start < content.length) {
		const newline = content.indexOf("\n", start);
		const end = newline === -1 ? content.length : newline;
		const line = content.slice(start, end);
		start = end + 1;
		if (!line.includes('"session_meta"')) continue;
		if (line.length > 16 * 1024 * 1024) continue;
		try {
			const record: unknown = JSON.parse(line);
			if (
				!isRecord(record) ||
				record.type !== "session_meta" ||
				!isRecord(record.payload)
			)
				continue;
			const parent = record.payload.forked_from_id;
			if (
				typeof parent === "string" &&
				parent !== "" &&
				parent !== record.payload.id
			)
				parents.add(parent);
		} catch {}
	}
	return [...parents];
}
