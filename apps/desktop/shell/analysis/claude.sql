CREATE TABLE c ENGINE = Memory AS
SELECT
	JSONExtractString(json, 'type') AS t,
	JSONExtractString(json, 'sessionId') AS sid,
	JSONExtractBool(json, 'isSidechain') AS side,
	parseDateTime64BestEffortOrNull(JSONExtractString(json, 'timestamp')) AS ts,
	JSONExtractString(json, 'cwd') AS cwd,
	JSONExtractString(json, 'message', 'id') AS mid,
	JSONExtractUInt(json, 'message', 'usage', 'output_tokens') AS out_tokens,
	JSONExtractString(json, 'message', 'model') AS model,
	JSONExtractUInt(json, 'message', 'usage', 'input_tokens') AS in_tokens,
	JSONExtractUInt(json, 'message', 'usage', 'cache_read_input_tokens') AS read_tokens,
	JSONExtractUInt(json, 'message', 'usage', 'cache_creation_input_tokens') AS write_tokens,
	JSONExtractUInt(json, 'message', 'usage', 'cache_creation', 'ephemeral_1h_input_tokens') AS write_1h_tokens,
	t = 'user' AND NOT JSONExtractBool(json, 'isMeta') AND position(json, '"tool_result"') = 0 AND NOT side AS is_prompt,
	arrayMap(x -> (JSONExtractString(x, 'id'), JSONExtractString(x, 'name'), JSONExtractString(x, 'input', 'command')),
		arrayFilter(x -> JSONExtractString(x, 'type') = 'tool_use', JSONExtractArrayRaw(json, 'message', 'content'))) AS uses,
	arrayMap(x -> JSONExtractString(x, 'tool_use_id'),
		arrayFilter(x -> JSONExtractString(x, 'type') = 'tool_result' AND JSONExtractBool(x, 'is_error'), JSONExtractArrayRaw(json, 'message', 'content'))) AS failed_ids
FROM file('{GLOB}', 'JSONAsString')
WHERE ts >= toStartOfDay(now()) - INTERVAL 29 DAY;

SELECT
	(SELECT uniqExact(sid) FROM c WHERE NOT side) AS sessions,
	(SELECT countIf(is_prompt) FROM c) AS prompts,
	(SELECT uniqExact(cwd) FROM c WHERE cwd != '') AS folders,
	(SELECT sum(o) FROM (SELECT max(out_tokens) AS o FROM c WHERE mid != '' GROUP BY mid)) AS output_tokens,
	(SELECT round(sum(d) / 3600, 1) FROM (
		SELECT least(dateDiff('second', min(ts), max(ts)), 7200) AS d
		FROM (SELECT sid, ts, sum(toUInt8(is_prompt)) OVER (PARTITION BY sid ORDER BY ts ROWS UNBOUNDED PRECEDING) AS turn FROM c WHERE NOT side AND ts IS NOT NULL)
		GROUP BY sid, turn HAVING turn > 0)) AS agent_hours,
	(SELECT count() FROM c ARRAY JOIN failed_ids AS f) AS failed_calls,
	(SELECT groupArray((label, n)) FROM (
		SELECT
			if(u.2 = 'Bash', arrayStringConcat(arraySlice(splitByWhitespace(replaceRegexpOne(u.3, '^(cd [^&;]+(&&|;)\\s*)+', '')), 1, 2), ' '), u.2) AS label,
			count() AS n
		FROM (SELECT arrayJoin(failed_ids) AS id FROM c) AS f
		INNER JOIN (SELECT arrayJoin(uses) AS u FROM c) AS used ON f.id = used.u.1
		GROUP BY label ORDER BY n DESC LIMIT 5)) AS stuck_on,
	(SELECT groupArray((name, n)) FROM (
		SELECT arrayElement(splitByChar('/', trimRight(cwd, '/')), -1) AS name, uniqExact(sid) AS n
		FROM c WHERE cwd != '' AND NOT side GROUP BY name ORDER BY n DESC LIMIT 5)) AS top_folders,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, uniqExact(sid) AS n FROM c WHERE NOT side AND ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_sessions,
	(SELECT groupArray((d, h)) FROM (
		SELECT toString(toDate(start)) AS d, round(sum(dur) / 3600, 2) AS h FROM (
			SELECT min(ts) AS start, least(dateDiff('second', min(ts), max(ts)), 7200) AS dur
			FROM (SELECT sid, ts, sum(toUInt8(is_prompt)) OVER (PARTITION BY sid ORDER BY ts ROWS UNBOUNDED PRECEDING) AS turn FROM c WHERE NOT side AND ts IS NOT NULL)
			GROUP BY sid, turn HAVING turn > 0)
		GROUP BY d ORDER BY d)) AS daily_hours,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, countIf(is_prompt) AS n FROM c WHERE ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_prompts,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, sum(length(failed_ids)) AS n FROM c WHERE ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_failed,
	(SELECT groupArray((d, model, band, i, o, cr, cw5, cw1)) FROM (
		SELECT toString(toDate(at)) AS d, used_model AS model, multiIf(ctx > 272000, 2, ctx > 200000, 1, 0) AS band,
			sum(i) AS i, sum(o) AS o, sum(cr) AS cr, sum(cw5) AS cw5, sum(cw1) AS cw1
		FROM (
			SELECT mid, any(ts) AS at, any(model) AS used_model, max(in_tokens) AS i, max(out_tokens) AS o, max(read_tokens) AS cr,
				greatest(max(write_tokens), max(write_1h_tokens)) - max(write_1h_tokens) AS cw5, max(write_1h_tokens) AS cw1,
				max(in_tokens) + max(read_tokens) + max(write_tokens) AS ctx
			FROM c WHERE mid != '' AND model != '' AND model != '<synthetic>' AND ts IS NOT NULL GROUP BY mid)
		GROUP BY d, used_model, band)) AS daily_usage,
	(SELECT groupArray((m, start, events, folder, tokens, seconds, prompts, failed)) FROM (
		SELECT s.m AS m, s.start AS start, s.events AS events, s.folder AS folder, t.tokens AS tokens, d.seconds AS seconds, f.prompts AS prompts, f.failed AS failed
		FROM (SELECT sid, ifNull(topKIf(1)(model, model NOT IN ('', '<synthetic>'))[1], '') AS m, toUnixTimestamp(min(ts)) AS start, count() AS events, arrayElement(splitByChar('/', trimRight(argMinIf(cwd, ts, cwd != ''), '/')), -1) AS folder FROM c WHERE NOT side AND sid != '' GROUP BY sid) AS s
		LEFT JOIN (SELECT sid, sum(i + o + r + w) AS tokens FROM (SELECT sid, mid, max(in_tokens) AS i, max(out_tokens) AS o, max(read_tokens) AS r, max(write_tokens) AS w FROM c WHERE mid != '' GROUP BY sid, mid) GROUP BY sid) AS t ON s.sid = t.sid
		LEFT JOIN (SELECT sid, sum(dur) AS seconds FROM (SELECT sid, least(dateDiff('second', min(ts), max(ts)), 7200) AS dur FROM (SELECT sid, ts, sum(toUInt8(is_prompt)) OVER (PARTITION BY sid ORDER BY ts ROWS UNBOUNDED PRECEDING) AS turn FROM c WHERE NOT side AND ts IS NOT NULL) GROUP BY sid, turn HAVING turn > 0) GROUP BY sid) AS d ON s.sid = d.sid
		LEFT JOIN (SELECT sid, countIf(is_prompt) AS prompts, sum(length(failed_ids)) AS failed FROM c WHERE sid != '' GROUP BY sid) AS f ON s.sid = f.sid
		ORDER BY start)) AS session_models,
	(SELECT min(ts) FROM c) AS first_seen,
	(SELECT max(ts) FROM c) AS last_seen
FORMAT JSONEachRow;
