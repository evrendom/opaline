export function codexForkFixture({
	parent = true,
	ownUsage = false,
}: {
	parent?: boolean;
	ownUsage?: boolean;
} = {}) {
	const start = "2026-08-28T19:01:59.000Z";
	const replayAt = "2026-08-28T19:01:59.020Z";
	const ownAt = "2026-08-28T19:02:03.000Z";
	const records: unknown[] = [
		{
			type: "session_meta",
			timestamp: start,
			payload: {
				id: "fork-session",
				model_provider: "openai",
				...(parent ? { forked_from_id: "parent-session" } : {}),
			},
		},
		{
			type: "response_item",
			timestamp: start,
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Inspect the changes" }],
			},
		},
		{
			type: "turn_context",
			timestamp: start,
			payload: { model: "gpt-5.6-sol" },
		},
		...[1, 2].map((index) => ({
			type: "event_msg",
			timestamp: replayAt,
			payload: {
				type: "token_count",
				info: {
					last_token_usage: {
						input_tokens: 100000,
						cached_input_tokens: 80000,
						output_tokens: 10000,
					},
					total_token_usage: {
						input_tokens: index * 100000,
						cached_input_tokens: index * 80000,
						output_tokens: index * 10000,
					},
				},
			},
		})),
		{
			type: "response_item",
			timestamp: replayAt,
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Copied parent response" }],
			},
		},
	];
	if (ownUsage)
		records.push(
			{
				type: "turn_context",
				timestamp: ownAt,
				payload: { model: "gpt-5.6-sol" },
			},
			{
				type: "event_msg",
				timestamp: ownAt,
				payload: {
					type: "token_count",
					info: {
						service_tier: "priority",
						last_token_usage: {
							input_tokens: 50000,
							cached_input_tokens: 40000,
							output_tokens: 5000,
						},
						total_token_usage: {
							input_tokens: 250000,
							cached_input_tokens: 200000,
							output_tokens: 25000,
						},
					},
				},
			},
			{
				type: "response_item",
				timestamp: ownAt,
				payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "New child response" }],
				},
			},
		);
	return records.map((record) => JSON.stringify(record)).join("\n");
}
