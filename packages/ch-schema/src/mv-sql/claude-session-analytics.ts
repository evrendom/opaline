/**
 * Kept outside `src/db/schema/**` so chkit does not discover it as a schema
 * entrypoint. The schema and its regression tests import this single SQL source.
 */
export const CLAUDE_SESSION_ANALYTICS_MV_SQL = `
  SELECT * EXCEPT (_dedupe_rank)
  FROM (
  WITH
    (
      length(cs.content) > 120000000
      OR countSubstrings(cs.content, '\\n') > 8000
    ) AS _is_capped,

    if(_is_capped, '', cs.content) AS _line_safe_content,
    substring(cs.content, 1, 20000000) AS _error_sample_content,

    arrayFilter(
      x -> JSONExtractString(x, 'type') IN ('user', 'assistant'),
      splitByChar('\\n', _line_safe_content)
    ) AS _interaction_lines,

    arrayFilter(x -> JSONHas(x, 'timestamp'), _interaction_lines) AS _ts_lines,

    arrayMap(
      x -> parseDateTime64BestEffort(JSONExtractString(x, 'timestamp')),
      _ts_lines
    ) AS _timestamps,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'assistant' AND JSONHas(x, 'message'),
      splitByChar('\\n', _line_safe_content)
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
            splitByChar('\\n', if(
              length(transcript) > 120000000 OR countSubstrings(transcript, '\\n') > 8000,
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
    'claude_code' as source,
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
              splitByChar('\\n', _line_safe_content)
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

  FROM rudel.claude_sessions AS cs
  WHERE _is_capped OR length(_timestamps) > 0
  )
  WHERE _dedupe_rank = 1`;
