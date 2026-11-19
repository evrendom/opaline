import { describe, expect, test } from "bun:test";
import {
	FACT_MATRIX_PATH,
	renderFactMatrix,
	shortSource,
} from "./fact-matrix.js";

const repoFile = (path: string) =>
	Bun.file(new URL(`../../../../../${path}`, import.meta.url));

describe("the fact matrix", () => {
	test("the committed matrix is the one the catalog generates (run facts:matrix)", async () => {
		expect(await repoFile(FACT_MATRIX_PATH).text()).toBe(renderFactMatrix());
	});

	test("the L1 spec links the matrix for what is stored today", async () => {
		expect(await repoFile("docs/l1-literal-schema.md").text()).toContain(
			"(l1-fact-matrix.md)",
		);
	});

	test("source paths are shortened to what a reader recognizes", () => {
		expect(
			[
				"user.toolUseResult.timedOutAfterMs",
				"assistant.message.content[tool_use:Bash].input.timeout",
				"assistant.message.content[tool_use:*].name",
				"response_item/function_call:exec_command.arguments.workdir",
				"response_item/function_call_output.output~Rejected",
				"response_item/custom_tool_call_output.output[input_text].text~Rejected",
				"event_msg/item_completed:CommandExecution.parsed_cmd[].path",
				"turn_context/.approval_policy",
				"attachment/auto_mode.attachment.bypass",
				"system/stop_hook_summary.hookCount",
				"*.cwd",
			].map(shortSource),
		).toEqual([
			"toolUseResult.timedOutAfterMs",
			"Bash input.timeout",
			"tool_use.name",
			"exec_command args.workdir",
			"output “Rejected…”",
			"output “Rejected…”",
			"CommandExecution.parsed_cmd[].path",
			"turn_context.approval_policy",
			"auto_mode attachment bypass",
			"system stop_hook_summary hookCount",
			"every record cwd",
		]);
	});
});
