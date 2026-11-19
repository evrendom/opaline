export function claudeDuplicateFixture(childId: string, timestamp: string) {
	const priced = {
		type: "assistant",
		timestamp,
		requestId: "shared-request",
		message: {
			id: "shared-response",
			model: "claude-sonnet-4-5",
			content: [{ type: "text", text: "Second response" }],
			usage: { input_tokens: 1000, output_tokens: 100 },
		},
	};
	const user = (content: string) => ({
		type: "user",
		timestamp,
		message: { role: "user", content },
	});
	return {
		content: [
			user("First prompt"),
			{
				type: "assistant",
				timestamp,
				message: { content: [{ type: "text", text: "First response" }] },
			},
			{ type: "system", timestamp },
			{ type: "system", timestamp },
			user("Second prompt"),
			priced,
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
		subagents: {
			[childId]: [user("Delegated task"), priced]
				.map((line) => JSON.stringify(line))
				.join("\n"),
		},
	};
}

export function codexInFileUsageFixture(timestamp: string) {
	return [
		{ type: "turn_context", timestamp, payload: { model: "gpt-5" } },
		{
			type: "response_item",
			timestamp,
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Parent task" }],
			},
		},
		{ type: "event_msg", timestamp, payload: { type: "task_started" } },
		{
			type: "response_item",
			timestamp,
			payload: {
				type: "message",
				role: "user",
				agent: { agent_name: "/root/worker" },
				content: [{ type: "input_text", text: "Child task" }],
			},
		},
		{
			type: "event_msg",
			timestamp,
			payload: {
				type: "token_count",
				agent: { agent_name: "/root/worker" },
				info: {
					total_token_usage: {
						input_tokens: 1000,
						cached_input_tokens: 0,
						output_tokens: 100,
						reasoning_output_tokens: 0,
						total_tokens: 1100,
					},
					last_token_usage: {
						input_tokens: 1000,
						cached_input_tokens: 0,
						output_tokens: 100,
						reasoning_output_tokens: 0,
						total_tokens: 1100,
					},
				},
			},
		},
		{
			type: "response_item",
			timestamp,
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Parent response" }],
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}
