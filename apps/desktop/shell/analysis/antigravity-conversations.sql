-- Antigravity's own record of its conversations: a subagent's parent and the
-- folder each worked in.
INSERT INTO conversations
SELECT conversation_id AS sid, parent_conversation_id AS parent,
	arrayElement(splitByChar('/', trimRight(replaceRegexpOne(JSONExtractString(workspace_uris, 1), '^file://', ''), '/')), -1) AS folder
FROM sqlite('{DB}', 'conversation_summaries');
