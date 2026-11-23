-- Gemini CLI and Antigravity sessions, stored in Claude Code's transcript
-- shape, with the same analytics view as Claude Code under source 'gemini'.

-- operation: create_table key=table:rudel.gemini_sessions risk=safe
CREATE TABLE IF NOT EXISTS rudel.gemini_sessions
(
  `session_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `last_interaction_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `session_id` String,
  `organization_id` String,
  `project_path` String,
  `git_remote` String DEFAULT '',
  `package_name` String DEFAULT '',
  `package_type` String DEFAULT '',
  `content` String,
  `filter_version` UInt8 DEFAULT 0,
  `revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16),
  `ingested_at` DateTime64(3, 'UTC') DEFAULT now64(3),
  `user_id` String,
  `git_branch` Nullable(String),
  `git_sha` Nullable(String),
  `tag` Nullable(String),
  `subagents` Map(String, String) DEFAULT map()
) ENGINE = ReplacingMergeTree(revision)
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`)
ORDER BY (`organization_id`, `session_date`, `session_id`)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3';

-- operation: create_materialized_view key=materialized_view:rudel.gemini_session_analytics_mv risk=caution
CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.gemini_session_analytics_mv TO rudel.session_analytics AS
SELECT * EXCEPT (_dedupe_rank)
  FROM (
  WITH
    (
      length(cs.content) > 120000000
      OR countSubstrings(cs.content, '\n') > 8000
    ) AS _is_capped,

    if(_is_capped, '', cs.content) AS _line_safe_content,
    substring(cs.content, 1, 20000000) AS _error_sample_content,

    arrayFilter(
      x -> JSONExtractString(x, 'type') IN ('user', 'assistant'),
      splitByChar('\n', _line_safe_content)
    ) AS _interaction_lines,

    arrayFilter(x -> JSONHas(x, 'timestamp'), _interaction_lines) AS _ts_lines,

    arrayMap(
      x -> parseDateTime64BestEffort(JSONExtractString(x, 'timestamp')),
      _ts_lines
    ) AS _timestamps,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'assistant' AND JSONHas(x, 'message'),
      splitByChar('\n', _line_safe_content)
    ) AS _assistant_lines,

    arrayMap(
      x -> JSONExtractString(JSONExtractRaw(x, 'message'), 'id'),
      _assistant_lines
    ) AS _assistant_ids,

    arrayFilter(
      (x, i) -> i = length(_assistant_ids) OR
        _assistant_ids[i] != _assistant_ids[i + 1],
      _assistant_lines,
      arrayEnumerate(_assistant_lines)
    ) AS _deduped_assistant_lines,

    arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'input_tokens'))
      + toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_read_input_tokens'))
      + toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_creation_input_tokens')), _deduped_assistant_lines)) AS _input_tokens,
    arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'output_tokens')), _deduped_assistant_lines)) AS _output_tokens,
    arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_read_input_tokens')), _deduped_assistant_lines)) AS _cache_read,
    arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_creation_input_tokens')), _deduped_assistant_lines)) AS _cache_creation,

    arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"Skill"[^}]*"skill":"([^"]+)"'))) AS _skills,
    arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"Task"[^}]*"subagent_type":"([^"]+)"'))) AS _subagent_types,
    arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '<command-name>/([^<]+)</command-name>'))) AS _slash_commands,

    arraySort(agent -> tupleElement(agent, 1), arrayMap(
      (agent_id, transcript) -> tuple(
        agent_id,
        arrayElement(arrayMap(
          line -> JSONExtractString(line, 'message', 'model'),
          arrayFilter(
            line -> JSONExtractString(line, 'type') = 'assistant'
              AND JSONExtractString(line, 'message', 'model') != '',
            splitByChar('\n', if(
              length(transcript) > 120000000 OR countSubstrings(transcript, '\n') > 8000,
              '', transcript
            ))
          )
        ), -1)
      ),
      mapKeys(cs.subagents), mapValues(cs.subagents)
    )) AS _native_subagents,

    toUInt32(
      length(extractAll(_error_sample_content, '"isApiErrorMessage":true'))
      + length(extractAll(_error_sample_content, '"is_error":true'))
    ) AS _error_count,

    if(_is_capped, cs.session_date, arrayMin(_timestamps)) AS _session_date,
    if(_is_capped, cs.last_interaction_date, arrayMax(_timestamps)) AS _last_interaction_date,
    dateDiff('minute', _session_date, _last_interaction_date) AS _duration_min

  SELECT
    * EXCEPT (session_date, last_interaction_date, content, subagents),
    _session_date as session_date,
    _last_interaction_date as last_interaction_date,
    'gemini' as source,
    _input_tokens as input_tokens,
    _output_tokens as output_tokens,
    _cache_read as cache_read_input_tokens,
    _cache_creation as cache_creation_input_tokens,
    _input_tokens + _output_tokens as total_tokens,
	    _skills as skills,
	    _slash_commands as slash_commands,
	    _subagent_types as subagent_types,
	    toUInt32(length(cs.subagents)) as subagent_count,
	    _native_subagents as native_subagents,
	    toUInt32(length(_timestamps)) as total_interactions,
    toUInt32(_duration_min) as actual_duration_min,
    _error_count as error_count,
    if(
      _is_capped,
      '',
      JSONExtractString(
        JSONExtractRaw(
          arrayElement(
            arrayFilter(
              x -> JSONExtractString(x, 'type') = 'assistant',
              splitByChar('\n', _line_safe_content)
            ),
            -1
          ),
          'message'
        ),
        'model'
      )
    ) as model_used,
    ROW_NUMBER() OVER (
      PARTITION BY cs.organization_id, cs.user_id, cs.session_id
      ORDER BY cs.revision DESC
    ) AS _dedupe_rank

  FROM rudel.gemini_sessions AS cs
  WHERE _is_capped OR length(_timestamps) > 0
  )
  WHERE _dedupe_rank = 1;
