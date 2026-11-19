import { describe, expect, test } from "bun:test";
import { cityHash64, wordShingleSimHashUTF8 } from "./clickhouse-hashes.js";

describe("ClickHouse hashes in TypeScript", () => {
	test.each([
		["", "11160318154034397263"],
		["a", "2603192927274642682"],
		["hello", "2578220239953316063"],
		["git push origin", "5644087378976894043"],
		["cd ~/repo && bun test x", "13301981828035354828"],
		["bun run check-types && bun test src/a.test.ts", "18338072763472720540"],
		["cd /tmp && ls -la ".repeat(9), "11874472188165742190"],
		["é日本🙂", "676493145309541499"],
	])("cityHash64(%j) is ClickHouse's", (text, expected) => {
		expect(cityHash64(text).toString()).toBe(expected);
	});

	test.each([
		["", 0],
		["abc ab a", 0],
		["word0", 3321819333],
		["a word0", 3321819333],
		["word0 word1 word2 word3", 67633379],
		[
			"one two three four five six seven eight nine ten eleven twelve",
			17139747,
		],
		["alpha_beta gamma delta", 404758785],
	])("wordShingleSimHashUTF8(%j) is ClickHouse's", (text, expected) => {
		expect(wordShingleSimHashUTF8(text)).toBe(expected);
	});
});
