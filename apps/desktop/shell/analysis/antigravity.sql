-- One Antigravity brain folder's transcripts (<appData>/brain/<conversation>).
INSERT INTO g
SELECT
	extract(_path, '/brain/([^/]+)/') AS sid,
	multiIf(t = 'USER_INPUT', 'prompt', t = 'PLANNER_RESPONSE', 'response', t = 'GENERIC', 'result', 'other') AS kind,
	parseDateTime64BestEffortOrNull(JSONExtractString(json, 'created_at')) AS ts,
	toString(JSONExtractInt(json, 'step_index')) AS key,
	'' AS folder,
	JSONExtractString(json, 'model') AS model,
	JSONExtractUInt(json, 'input_tokens') AS i,
	JSONExtractUInt(json, 'cache_read_tokens') AS cr,
	JSONExtractUInt(json, 'output_tokens') AS o,
	toUInt32(t = 'GENERIC' AND JSONExtractString(json, 'status') = 'ERROR') AS failed,
	CAST([], 'Array(String)') AS failed_labels
FROM (SELECT _path, json, JSONExtractString(json, 'type') AS t FROM file('{GLOB}', 'JSONAsString'));
