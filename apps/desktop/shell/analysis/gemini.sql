-- Gemini CLI chats and Antigravity transcripts, in the shape claude.sql and
-- codex.sql answer. analyze.js puts one INSERT per folder
-- that holds sessions (gemini-cli.sql, antigravity.sql), and one per
-- Antigravity conversation database (antigravity-conversations.sql), below.
CREATE TABLE g (
	sid String,
	kind LowCardinality(String),
	ts Nullable(DateTime64(3)),
	key String,
	folder String,
	model String,
	i UInt64,
	cr UInt64,
	o UInt64,
	failed UInt32,
	failed_labels Array(String)
) ENGINE = Memory;

CREATE TABLE conversations (sid String, parent String, folder String) ENGINE = Memory;

{SOURCES}

CREATE TABLE s ENGINE = Memory AS
SELECT g.sid AS sid, g.kind AS kind, g.ts AS ts, g.key AS key,
	if(g.folder != '', g.folder, ifNull(c.folder, '')) AS folder,
	g.model AS model, g.i AS i, g.cr AS cr, g.o AS o, g.failed AS failed, g.failed_labels AS failed_labels,
	ifNull(c.parent, '') != '' AS side
FROM g LEFT JOIN conversations AS c ON g.sid = c.sid
WHERE g.ts >= toStartOfDay(now()) - INTERVAL 29 DAY;

-- Gemini CLI writes a message again as it fills in: one row per key.
CREATE TABLE r ENGINE = Memory AS
SELECT sid, key, min(ts) AS at, argMax(model, o) AS used_model,
	max(i) AS ui, max(cr) AS ucr, max(o) AS uo
FROM s WHERE kind = 'response' AND key != '' GROUP BY sid, key;

CREATE TABLE f ENGINE = Memory AS
SELECT sid, key, min(ts) AS at, max(failed) AS fails, argMax(failed_labels, failed) AS labels
FROM s WHERE failed > 0 GROUP BY sid, key;

CREATE TABLE turns ENGINE = Memory AS
SELECT sid, min(ts) AS start, least(dateDiff('second', min(ts), max(ts)), 7200) AS dur
FROM (SELECT sid, ts, sum(toUInt8(kind = 'prompt')) OVER (PARTITION BY sid ORDER BY ts ROWS UNBOUNDED PRECEDING) AS turn
	FROM s WHERE NOT side AND ts IS NOT NULL)
GROUP BY sid, turn HAVING turn > 0;

SELECT
	(SELECT uniqExact(sid) FROM s WHERE NOT side) AS sessions,
	(SELECT uniqExactIf((sid, key), kind = 'prompt') FROM s WHERE NOT side) AS prompts,
	(SELECT uniqExact(folder) FROM s WHERE folder != '') AS folders,
	(SELECT sum(uo) FROM r) AS output_tokens,
	(SELECT round(sum(dur) / 3600, 1) FROM turns) AS agent_hours,
	(SELECT sum(fails) FROM f) AS failed_calls,
	(SELECT groupArray((label, n)) FROM (
		SELECT label, count() AS n FROM f ARRAY JOIN labels AS label WHERE label != ''
		GROUP BY label ORDER BY n DESC LIMIT 5)) AS stuck_on,
	(SELECT groupArray((name, n)) FROM (
		SELECT folder AS name, uniqExact(sid) AS n FROM s WHERE folder != '' AND NOT side
		GROUP BY name ORDER BY n DESC LIMIT 5)) AS top_folders,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, uniqExact(sid) AS n FROM s WHERE NOT side AND ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_sessions,
	(SELECT groupArray((d, h)) FROM (
		SELECT toString(toDate(start)) AS d, round(sum(dur) / 3600, 2) AS h FROM turns GROUP BY d ORDER BY d)) AS daily_hours,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(ts)) AS d, uniqExactIf((sid, key), kind = 'prompt') AS n FROM s WHERE NOT side AND ts IS NOT NULL GROUP BY d ORDER BY d)) AS daily_prompts,
	(SELECT groupArray((d, n)) FROM (
		SELECT toString(toDate(at)) AS d, sum(fails) AS n FROM f WHERE at IS NOT NULL GROUP BY d ORDER BY d)) AS daily_failed,
	(SELECT groupArray((d, model, band, i, o, cr, 0, 0)) FROM (
		SELECT toString(toDate(at)) AS d, used_model AS model, multiIf(ui + ucr > 272000, 2, ui + ucr > 200000, 1, 0) AS band,
			sum(ui) AS i, sum(uo) AS o, sum(ucr) AS cr
		FROM r WHERE used_model != '' AND at IS NOT NULL GROUP BY d, used_model, band)) AS daily_usage,
	(SELECT groupArray((m, start, events, folder, tokens, seconds, prompts, failed)) FROM (
		SELECT a.m AS m, a.start AS start, a.events AS events, a.folder AS folder, ifNull(t.tokens, 0) AS tokens,
			ifNull(d.seconds, 0) AS seconds, a.prompts AS prompts, ifNull(x.failed, 0) AS failed
		FROM (SELECT sid, ifNull(topKIf(1)(model, model != '')[1], '') AS m, toUnixTimestamp(min(ts)) AS start, count() AS events,
				any(folder) AS folder, uniqExactIf(key, kind = 'prompt') AS prompts
			FROM s WHERE NOT side GROUP BY sid) AS a
		LEFT JOIN (SELECT sid, sum(ui + ucr + uo) AS tokens FROM r GROUP BY sid) AS t ON a.sid = t.sid
		LEFT JOIN (SELECT sid, sum(dur) AS seconds FROM turns GROUP BY sid) AS d ON a.sid = d.sid
		LEFT JOIN (SELECT sid, sum(fails) AS failed FROM f GROUP BY sid) AS x ON a.sid = x.sid
		ORDER BY start)) AS session_models,
	(SELECT min(ts) FROM s) AS first_seen,
	(SELECT max(ts) FROM s) AS last_seen
FORMAT JSONEachRow;
