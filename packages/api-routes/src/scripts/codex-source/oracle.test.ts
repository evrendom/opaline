import { describe, expect, test } from "bun:test";
import snapshot from "../../session-transcript/transcript-records/codex-source-0.162.0.json" with {
	type: "json",
};
import { expansionAt, SourceExpander, serdeName } from "./expand.js";
import { completedItemPolicy, persistenceMatch } from "./persistence.js";
import { parseRust, RustIndex, tokenizeRust } from "./rust-source.js";

function expandSnippet(source: string, name = "Root") {
	const index = new RustIndex();
	index.add(source, "protocol/src/snippet.rs", "protocol");
	const root = index.resolve(
		{ kind: "path", segments: [name], args: [] },
		"protocol/src/snippet.rs",
	);
	if (root === undefined) throw new Error("Missing snippet root");
	const expander = new SourceExpander(index);
	expander.heads.add("sample/");
	expander.setPolicy({
		file: "policy.rs",
		line: 1,
		decision: "synthetic persisted root",
		modes: "both",
	});
	expander.expand(
		{ kind: "path", segments: [name], args: [] },
		expansionAt("sample/", root),
	);
	return expander;
}

describe("Rust writer-source subset", () => {
	test("keeps line provenance and ignores nested comments, strings, functions and test modules", () => {
		const source =
			'/* outer /* struct Fake {} */ */\nconst TEXT: &str = r#"enum Fake {}"#;\nfn ignored() { struct Fake {} }\n#[cfg(test)] mod tests { struct Fake {} }\n#[derive(Serialize)] pub struct Root { pub value: String }';
		const parsed = parseRust(source);
		expect(parsed.definitions.map((definition) => definition.name)).toEqual([
			"Root",
		]);
		expect(parsed.definitions[0]?.line).toBe(5);
		expect(tokenizeRust('r###"a\nb"###')[0]).toEqual({
			kind: "string",
			text: "a\nb",
			line: 1,
		});
	});
	test("expands aliases, generics, flatten, maps and serde serialization names", () => {
		const expander = expandSnippet(`
type Values = Vec<[u8; 20]>;
struct Envelope<T> { value: T }
#[serde(rename_all = "camelCase")]
struct Child { final_value: bool }
struct Root {
 #[serde(flatten)] child: Child,
 #[serde(rename(serialize = "renamed", deserialize = "old"))] nested: Envelope<Values>,
 changes: BTreeMap<String, Child>,
 #[serde(skip_serializing)] omitted: bool,
}
`);
		expect(expander.result().map((entry) => entry.path)).toEqual([
			"sample/.changes",
			"sample/.changes.{*}.finalValue",
			"sample/.finalValue",
			"sample/.renamed.value",
			"sample/.renamed.value[]",
			"sample/.renamed.value[][]",
		]);
		expect(expander.diagnostics.size).toBe(0);
	});
	test("enum renaming does not rename struct-variant fields without rename_all_fields", () => {
		const expander = expandSnippet(`
#[serde(tag = "type", rename_all = "kebab-case")]
enum Policy { WorkspaceWrite { network_access: bool, writable_roots: Vec<String> } }
#[serde(rename_all = "snake_case", rename_all_fields = "camelCase")]
enum Fields { First { final_value: bool }, #[serde(rename_all = "kebab-case")] Second { final_value: bool } }
#[serde(into = "String")] enum ThreadSource { User, Feature(String) }
struct Root { sandbox_policy: Policy, fields: Fields, thread_source: ThreadSource }
`);
		const paths = expander.result().map((entry) => entry.path);
		expect(paths).toContain("sample/.sandbox_policy.network_access");
		expect(paths).toContain("sample/.sandbox_policy.writable_roots[]");
		expect(paths).not.toContain("sample/.sandbox_policy.network-access");
		expect(paths).toContain("sample/.fields.first.finalValue");
		expect(paths).toContain("sample/.fields.second.final-value");
		expect(paths).toContain("sample/.thread_source");
		expect(paths).not.toContain("sample/.thread_source.Feature");
	});
	test("pinned wire paths use the serializer even when its impl is in another module", () => {
		const paths = snapshot.paths.map((entry) => entry.path);
		expect(paths).toContain(
			"event_msg/turn_aborted.error.codex_error_info.http_connection_failed.http_status_code",
		);
		expect(paths).not.toContain(
			"event_msg/turn_aborted.error.codex_error_info.HttpConnectionFailed.http_status_code",
		);
		expect(paths).toContain("session_meta/.thread_source");
		expect(paths).not.toContain("session_meta/.thread_source.Feature");
	});
	test("typed content blocks, tagged, adjacent and untagged enum shapes match census notation", () => {
		const expander = expandSnippet(`
#[serde(tag = "type", rename_all = "snake_case")]
enum Block { InputText { text: String }, #[serde(skip)] Hidden { value: bool } }
#[serde(tag = "kind", content = "body", rename_all = "snake_case")]
enum Action { Run { value: u64 }, Stop }
#[serde(untagged)] enum Output { Text(String), Items(Vec<Block>) }
struct Root { content: Vec<Block>, action: Action, output: Output }
`);
		const paths = expander.result().map((entry) => entry.path);
		expect(paths).toContain("sample/.content[input_text].text");
		expect(paths).not.toContain("sample/.content[input_text].type");
		expect(paths).toContain("sample/.action.body.value");
		expect(paths).toContain("sample/.output[input_text].text");
		expect(expander.diagnostics.size).toBe(0);
	});
	test("skipped Option nulls, dynamic ids, recursive types and opaque JSON stay explicit", () => {
		const expander = expandSnippet(`
struct Child { call_id: String }
struct Root {
 optional: Option<Child>,
 #[serde(skip_serializing_if = "Option::is_none")] omitted_when_null: Option<Child>,
 output: serde_json::Value,
 custom: Unknown,
 recursive: Option<Box<Root>>,
}
`);
		expect(
			expander.result().find((entry) => entry.path === "sample/.optional")
				?.type,
		).toBe("null");
		expect(
			expander
				.result()
				.some((entry) => entry.path === "sample/.omitted_when_null"),
		).toBe(false);
		expect(expander.result().map((entry) => entry.path)).toContain(
			"sample/.optional.{*}",
		);
		expect(
			expander.result().find((entry) => entry.path === "sample/.output")?.scope,
		).toBe("opaque");
		expect(
			expander.result().find((entry) => entry.path === "sample/.custom")?.scope,
		).toBe("unknown");
		expect(expander.diagnostics.size).toBe(2);
	});
	test("resolves explicit module hints and rejects unresolved ambiguity rather than picking a definition", () => {
		const index = new RustIndex();
		index.add(
			"struct Root {} enum PlanType { One }",
			"protocol/src/root.rs",
			"protocol",
		);
		index.add("enum PlanType { Two }", "protocol/src/account.rs", "protocol");
		expect(
			index.resolve(
				{ kind: "path", segments: ["crate", "account", "PlanType"], args: [] },
				"protocol/src/root.rs",
			)?.file,
		).toBe("protocol/src/account.rs");
		expect(
			index.resolve(
				{ kind: "path", segments: ["PlanType"], args: [] },
				"unknown.rs",
			),
		).toBeUndefined();
		expect(serdeName("HTTPServer", {}, "snake_case", true)).toBe("http_server");
		expect(() => serdeName("value", {}, "invented")).toThrow(
			"Unsupported serde",
		);
	});
	test("manual serializers never silently reuse the in-memory struct shape", () => {
		const expander = expandSnippet(
			"struct Custom { internal: String } impl Serialize for Custom { fn serialize() {} } struct Root { custom: Custom }",
		);
		expect(expander.result().map((entry) => entry.path)).toEqual([
			"sample/.custom",
		]);
		expect(expander.result()[0]?.scope).toBe("unknown");
	});
});

describe("rollout persistence decisions", () => {
	test("groups arms, handles block arms without commas and preserves conditional decisions", () => {
		const policy = persistenceMatch(
			`fn persisted_event_msg(ev: &EventMsg) -> bool { match ev {
 EventMsg::First(_) => { persisted_item_completed_event(ev) }
 EventMsg::Second(_) | EventMsg::Third(_) => Some(ev),
 EventMsg::Legacy(_) => { matches!(history_mode, ThreadHistoryMode::Legacy).then_some(ev) }
 EventMsg::Transient(_) => None,
}}`,
			"persisted_event_msg",
			"EventMsg",
		);
		expect([...policy.keys()]).toEqual([
			"First",
			"Second",
			"Third",
			"Legacy",
			"Transient",
		]);
		expect(policy.get("Legacy")?.modes).toBe("legacy");
		expect(policy.get("Transient")?.modes).toBe("none");
		expect(policy.get("Second")?.line).toBe(3);
		expect(() =>
			persistenceMatch(
				"fn policy() { match ev { EventMsg::Changed(_) => future_policy(ev), } }",
				"policy",
				"EventMsg",
			),
		).toThrow("Unknown persistence expression");
	});
	test("unknown ItemCompleted legacy predicates require adapter review", () => {
		expect(() =>
			completedItemPolicy(
				"fn persisted_item_completed_event() { match history_mode { ThreadHistoryMode::Legacy => { matches!(event.item, TurnItem::NewType(_)).then_some(ev) } } }",
				"NewType",
			),
		).toThrow("New legacy ItemCompleted condition");
	});
	test("pinned snapshot is sorted, attributed and excludes transient exec end events", () => {
		expect(snapshot.version).toBe("0.162.0");
		expect(snapshot.paths.length).toBeGreaterThan(2000);
		const paths = snapshot.paths.map((entry) => entry.path);
		expect(paths).toEqual(
			[...paths].sort((left, right) => left.localeCompare(right)),
		);
		expect(new Set(paths).size).toBe(paths.length);
		expect(
			paths.some((path) => path.startsWith("event_msg/exec_command_end")),
		).toBe(false);
		for (const entry of snapshot.paths) {
			expect(entry.source).toMatch(/^codex-rs\/.+\.rs:\d+$/u);
			expect(snapshot.policies[entry.policy]?.modes).not.toBe("none");
		}
		expect(
			snapshot.paths.find(
				(entry) =>
					entry.path === "event_msg/item_completed:CommandExecution.exit_code",
			)?.modes,
		).toBe("paginated");
	});
});
