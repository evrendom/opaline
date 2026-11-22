-- One Gemini CLI project folder's chats (~/.gemini/tmp/<project>/chats).
INSERT INTO g
SELECT
	_path AS sid,
	if(t = 'user', 'prompt', 'response') AS kind,
	parseDateTime64BestEffortOrNull(JSONExtractString(json, 'timestamp')) AS ts,
	JSONExtractString(json, 'id') AS key,
	extract(_path, '/tmp/([^/]+)/chats/') AS folder,
	JSONExtractString(json, 'model') AS model,
	greatest(JSONExtractUInt(json, 'tokens', 'input') + JSONExtractUInt(json, 'tokens', 'tool'), JSONExtractUInt(json, 'tokens', 'cached'))
		- JSONExtractUInt(json, 'tokens', 'cached') AS i,
	JSONExtractUInt(json, 'tokens', 'cached') AS cr,
	JSONExtractUInt(json, 'tokens', 'output') + JSONExtractUInt(json, 'tokens', 'thoughts') AS o,
	toUInt32(length(errors)) AS failed,
	arrayMap(c -> if(JSONExtractString(c, 'name') = 'run_shell_command',
		arrayStringConcat(arraySlice(splitByWhitespace(replaceRegexpOne(JSONExtractString(c, 'args', 'command'), '^(cd [^&;]+(&&|;)\\s*)+', '')), 1, 2), ' '),
		JSONExtractString(c, 'name')), errors) AS failed_labels
FROM (
	SELECT _path, json, JSONExtractString(json, 'type') AS t,
		arrayFilter(c -> JSONExtractString(c, 'status') = 'error', JSONExtractArrayRaw(json, 'toolCalls')) AS errors
	FROM file('{GLOB}', 'JSONAsString')
)
WHERE t IN ('user', 'gemini') AND JSONHas(json, 'id') AND NOT JSONHas(json, '$patch');
