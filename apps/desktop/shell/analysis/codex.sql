CREATE TABLE x ENGINE = Memory AS
SELECT
	_file AS sid,
	JSONExtractString(json, 'type') AS t,
	JSONExtractString(json, 'payload', 'type') AS pt,
	parseDateTime64BestEffortOrNull(JSONExtractString(json, 'timestamp')) AS ts,
	if(t IN ('session_meta', 'turn_context'), JSONExtractString(json, 'payload', 'cwd'), '') AS cwd,
	JSONExtractString(json, 'payload', 'turn_id') AS turn_id,
	JSONExtractString(json, 'payload', 'call_id') AS call_id,
	if(pt = 'function_call', JSONExtractString(json, 'payload', 'name'), '') AS fn,
	if(pt = 'function_call', JSONExtractString(JSONExtractString(json, 'payload', 'arguments'), 'cmd'), '') AS cmd,
	if(pt = 'function_call_output', toInt32OrZero(extract(JSONExtractString(json, 'payload', 'output'), 'Process exited with code (\\d+)')), 0) AS exit_code,
	if(pt = 'token_count', JSONExtractUInt(json, 'payload', 'info', 'total_token_usage', 'output_tokens'), 0) AS out_total,
	if(t = 'turn_context', JSONExtractString(json, 'payload', 'model'), '') AS model,
	if(pt = 'token_count', JSONExtractUInt(json, 'payload', 'info', 'total_token_usage', 'total_tokens'), 0) AS usage_key,
	if(pt = 'token_count', JSONExtractUInt(json, 'payload', 'info', 'last_token_usage', 'input_tokens'), 0) AS in_tokens,
	if(pt = 'token_count', JSONExtractUInt(json, 'payload', 'info', 'last_token_usage', 'cached_input_tokens'), 0) AS cached_tokens,
	if(pt = 'token_count', JSONExtractUInt(json, 'payload', 'info', 'last_token_usage', 'output_tokens'), 0) AS out_tokens
FROM file('{GLOB}', 'JSONAsString')
WHERE ts >= toStartOfDay(now()) - INTERVAL 29 DAY;

SELECT
	(SELECT uniqExact(sid) FROM x) AS sessions,
	(SELECT countIf(pt = 'task_started') FROM x) AS prompts,
	(SELECT uniqExact(cwd) FROM x WHERE cwd != '') AS folders,
	(SELECT sum(o) FROM (SELECT max(out_total) AS o FROM x GROUP BY sid)) AS output_tokens,
	(SELECT round(sum(d) / 3600, 1) FROM (
		SELECT least(dateDiff('second', min(ts), max(ts)), 7200) AS d FROM x
		WHERE pt IN ('task_started', 'task_complete') AND turn_id != '' GROUP BY sid, turn_id HAVING count() = 2)) AS agent_hours,
	(SELECT countIf(exit_code != 0) FROM x) AS failed_calls,
	(SELECT groupArray((label, n)) FROM (
		SELECT arrayStringConcat(arraySlice(splitByWhitespace(replaceRegexpOne(c.cmd, '^(cd [^&;]+(&&|;)\\s*)+', '')), 1, 2), ' ') AS label, count() AS n
		FROM (SELECT call_id FROM x WHERE exit_code != 0) AS f
		INNER JOIN (SELECT call_id, cmd FROM x WHERE fn != '' AND cmd != '') AS c ON f.call_id = c.call_id
		GROUP BY label ORDER BY n DESC LIMIT 5)) AS stuck_on,
	(SELECT groupArray((name, n)) FROM (
		SELECT arrayElement(splitByChar('/', trimRight(cwd, '/')), -1) AS name, uniqExact(sid) AS n
		FROM x WHERE cwd != '' GROUP BY name ORDER BY n DESC LIMIT 5)) AS top_folders,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, uniqExact(sid) AS n FROM x WHERE ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_sessions,
	(SELECT groupArray((d, h)) FROM (
		SELECT toString(toDate(start)) AS d, round(sum(dur) / 3600, 2) AS h FROM (
			SELECT min(ts) AS start, least(dateDiff('second', min(ts), max(ts)), 7200) AS dur FROM x
			WHERE pt IN ('task_started', 'task_complete') AND turn_id != '' GROUP BY sid, turn_id HAVING count() = 2)
		GROUP BY d ORDER BY d)) AS daily_hours,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, countIf(pt = 'task_started') AS n FROM x WHERE ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_prompts,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, countIf(exit_code != 0) AS n FROM x WHERE ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_failed,
	(SELECT groupArray((d, model, band, i, o, cr, 0, 0)) FROM (
		SELECT toString(toDate(u.at)) AS d, m.session_model AS model, multiIf(u.ctx > 272000, 2, u.ctx > 200000, 1, 0) AS band,
			sum(u.i) AS i, sum(u.o) AS o, sum(u.cr) AS cr
		FROM (
			SELECT sid, any(ts) AS at, any(greatest(in_tokens, cached_tokens) - cached_tokens) AS i, any(out_tokens) AS o, any(cached_tokens) AS cr, any(in_tokens) AS ctx
			FROM x WHERE pt = 'token_count' AND usage_key > 0 AND ts IS NOT NULL GROUP BY sid, usage_key) AS u
		LEFT JOIN (SELECT sid, argMax(model, ts) AS session_model FROM x WHERE model != '' GROUP BY sid) AS m ON u.sid = m.sid
		GROUP BY d, model, band)) AS daily_usage,
	(SELECT groupArray((m, start, events, folder, tokens, seconds, prompts, failed)) FROM (
		SELECT s.m AS m, s.start AS start, s.events AS events, s.folder AS folder, t.tokens AS tokens, d.seconds AS seconds, f.prompts AS prompts, f.failed AS failed
		FROM (SELECT sid, ifNull(argMaxIf(model, ts, model != ''), '') AS m, toUnixTimestamp(min(ts)) AS start, count() AS events, arrayElement(splitByChar('/', trimRight(ifNull(argMinIf(cwd, ts, cwd != ''), ''), '/')), -1) AS folder FROM x GROUP BY sid) AS s
		LEFT JOIN (SELECT sid, sum(i + o) AS tokens FROM (SELECT sid, any(in_tokens) AS i, any(out_tokens) AS o FROM x WHERE pt = 'token_count' AND usage_key > 0 GROUP BY sid, usage_key) GROUP BY sid) AS t ON s.sid = t.sid
		LEFT JOIN (SELECT sid, sum(dur) AS seconds FROM (SELECT sid, least(dateDiff('second', min(ts), max(ts)), 7200) AS dur FROM x WHERE pt IN ('task_started', 'task_complete') AND turn_id != '' GROUP BY sid, turn_id HAVING count() = 2) GROUP BY sid) AS d ON s.sid = d.sid
		LEFT JOIN (SELECT sid, countIf(pt = 'task_started') AS prompts, countIf(exit_code != 0) AS failed FROM x GROUP BY sid) AS f ON s.sid = f.sid
		ORDER BY start)) AS session_models,
	(SELECT min(ts) FROM x) AS first_seen,
	(SELECT max(ts) FROM x) AS last_seen
FORMAT JSONEachRow;
