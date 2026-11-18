import { describe, expect, test } from "bun:test";
import {
	CliUserSchema,
	IngestSessionInputSchema,
	IngestSessionOutputSchema,
	R2IngestInitInputSchema,
	R2IngestMetadataSchema,
} from "../index.js";

const HASH = "a".repeat(64);

describe("analysis-linked upload contract", () => {
	test("direct and R2 uploads carry a trimmed top-level analysisId", () => {
		const direct = IngestSessionInputSchema.parse({
			analysisId: " a_abc123 ",
			content: "{}",
			projectPath: "/chat",
			sessionId: "thread-1",
			source: "codex",
		});
		expect(direct.analysisId).toBe("a_abc123");

		const init = R2IngestInitInputSchema.parse({
			analysisId: "a_abc123",
			objects: [{ byteLength: 10, kind: "main", sha256: HASH }],
			projectPath: "/chat",
			sessionId: "thread-1",
			source: "codex",
		});
		expect(init.analysisId).toBe("a_abc123");
		// The R2 job stores this metadata, so materialization keeps the id.
		const { objects: _objects, ...metadata } = init;
		expect(R2IngestMetadataSchema.parse(metadata).analysisId).toBe("a_abc123");
	});

	test("analysisId stays optional and rejects empty or oversized ids", () => {
		expect(
			IngestSessionInputSchema.parse({
				content: "{}",
				projectPath: "/chat",
				sessionId: "thread-1",
			}).analysisId,
		).toBeUndefined();
		for (const analysisId of ["", "   ", "a".repeat(41)])
			expect(
				IngestSessionInputSchema.safeParse({
					analysisId,
					content: "{}",
					projectPath: "/chat",
					sessionId: "thread-1",
				}).success,
			).toBe(false);
	});

	test("the ingest result echoes a linked analysisId and stays valid without it", () => {
		const base = { redacted: {}, sessionId: "thread-1", success: true };
		expect(
			IngestSessionOutputSchema.parse({ ...base, analysisId: "a_abc123" })
				.analysisId,
		).toBe("a_abc123");
		expect(IngestSessionOutputSchema.parse(base).analysisId).toBeUndefined();
	});

	test("authStatus can advertise analysis-linked uploads; older servers omit it", () => {
		const user = { email: "a@example.com", id: "user-1", name: "A" };
		expect(
			CliUserSchema.parse({
				...user,
				capabilities: { analysisLinkedUploads: true },
			}).capabilities,
		).toEqual({ analysisLinkedUploads: true });
		expect(CliUserSchema.parse(user).capabilities).toBeUndefined();
	});

	test("authStatus can advertise transcript slimming; servers without it omit the field", () => {
		const user = { email: "a@example.com", id: "user-1", name: "A" };
		expect(
			CliUserSchema.parse({
				...user,
				capabilities: { analysisLinkedUploads: true, transcriptSlimming: true },
			}).capabilities,
		).toEqual({ analysisLinkedUploads: true, transcriptSlimming: true });
		expect(
			CliUserSchema.parse({
				...user,
				capabilities: { analysisLinkedUploads: true },
			}).capabilities?.transcriptSlimming,
		).toBeUndefined();
		expect(
			CliUserSchema.safeParse({
				...user,
				capabilities: {
					analysisLinkedUploads: true,
					transcriptSlimming: false,
				},
			}).success,
		).toBe(false);
	});
});
