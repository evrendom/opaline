/**
 * Kept outside `src/db/schema/**` so chkit does not discover it as a schema
 * entrypoint. The schema and its regression tests import this single SQL source.
 */
export const CODEX_SESSION_ANALYTICS_MV_SQL = `
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
      x -> x != '',
      splitByChar('\\n', _line_safe_content)
    ) AS _all_lines,

    arrayFilter(x -> JSONHas(x, 'timestamp'), _all_lines) AS _ts_lines,

    arrayMap(
      x -> parseDateTime64BestEffort(JSONExtractString(x, 'timestamp')),
      _ts_lines
    ) AS _timestamps,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'response_item' OR JSONExtractString(x, 'type') = 'event_msg',
      _all_lines
    ) AS _interaction_lines,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'response_item'
        AND JSONExtractString(JSONExtractRaw(x, 'payload'), 'type') = 'function_call_output',
      _all_lines
    ) AS _tool_output_lines,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'event_msg'
        AND JSONExtractString(JSONExtractRaw(x, 'payload'), 'type') = 'token_count'
        AND JSONExtractRaw(JSONExtractRaw(x, 'payload'), 'info') IS NOT NULL
        AND JSONExtractRaw(JSONExtractRaw(x, 'payload'), 'info') != 'null',
      _all_lines
    ) AS _token_count_lines,

    if(length(_token_count_lines) > 0,
      JSONExtractRaw(JSONExtractRaw(JSONExtractRaw(arrayElement(_token_count_lines, -1), 'payload'), 'info'), 'total_token_usage'),
      '{}'
    ) AS _final_usage,

    toUInt64OrZero(JSONExtractRaw(_final_usage, 'input_tokens')) AS _input_tokens,
    toUInt64OrZero(JSONExtractRaw(_final_usage, 'output_tokens')) AS _output_tokens,
    toUInt64OrZero(JSONExtractRaw(_final_usage, 'cached_input_tokens')) AS _cache_read_input_tokens,

    if(_is_capped, cs.session_date, arrayMin(_timestamps)) AS _session_date,
    if(_is_capped, cs.last_interaction_date, arrayMax(_timestamps)) AS _last_interaction_date,
    dateDiff('minute', _session_date, _last_interaction_date) AS _duration_min,

    arrayFilter(x -> JSONExtractString(x, 'type') = 'session_meta', _all_lines) AS _meta_lines,

    JSONExtractString(
      JSONExtractRaw(arrayElement(_meta_lines, 1), 'payload'),
      'model_provider'
    ) AS _model_provider,

    arrayFilter(
      x -> JSONExtractString(x, 'type') = 'turn_context',
      _all_lines
    ) AS _turn_context_lines,

    if(length(_turn_context_lines) > 0,
      JSONExtractString(JSONExtractRaw(arrayElement(_turn_context_lines, 1), 'payload'), 'model'),
      ''
    ) AS _model_from_turn_context,

	    arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"exec_command"[^}]*skills/([a-zA-Z0-9_-]+)/SKILL'))) AS _skills,

	    arrayMap(
	      x -> JSONExtractRaw(x, 'payload'),
	      extractAll(cs.content, '([^\\n]*"name":"spawn_agent"[^\\n]*)')
	    ) AS _spawn_candidate_payloads,

	    arrayFilter(
	      payload -> JSONExtractString(payload, 'type') = 'function_call'
	        AND JSONExtractString(payload, 'name') = 'spawn_agent',
	      _spawn_candidate_payloads
	    ) AS _spawn_payloads,

	    arrayDistinct(arrayFilter(
	      call_id -> call_id != '',
	      arrayMap(payload -> JSONExtractString(payload, 'call_id'), _spawn_payloads)
	    )) AS _spawn_call_ids,

	    arrayDistinct(arrayFilter(
	      call_id -> call_id != '',
	      extractAll(
	        cs.content,
	        '"type":"function_call_output"[^\\n]*?"call_id":"([^"]+)"[^\\n]*?"output":"\\\\{\\\\\\\\"(?:task_name|agent_name|agentId|agent_id)\\\\\\\\":'
	      )
	    )) AS _identifier_output_call_ids,

	    arrayDistinct(arrayFilter(
	      role -> role != '',
	      arrayMap(
	        payload -> if(
	          has(_identifier_output_call_ids, JSONExtractString(payload, 'call_id')),
	          multiIf(
	            JSONExtractString(JSONExtractString(payload, 'arguments'), 'agent_type') != '',
	              JSONExtractString(JSONExtractString(payload, 'arguments'), 'agent_type'),
	            JSONExtractString(JSONExtractString(payload, 'arguments'), 'agent') != '',
	              JSONExtractString(JSONExtractString(payload, 'arguments'), 'agent'),
	            ''
	          ),
	          ''
	        ),
	        _spawn_payloads
	      )
	    )) AS _subagent_types,

	    toUInt32(length(arrayIntersect(
	      _spawn_call_ids,
	      _identifier_output_call_ids
	    ))) AS _subagent_count,

    arrayMap(call_id -> tuple(
      concat('call:', call_id),
      JSONExtractString(JSONExtractString(arrayElement(arrayFilter(
        payload -> JSONExtractString(payload, 'call_id') = call_id,
        _spawn_payloads
      ), -1), 'arguments'), 'model')
    ), arraySort(arrayIntersect(_spawn_call_ids, _identifier_output_call_ids))) AS _native_subagents,

	    toUInt32(
      length(extractAll(_error_sample_content, '\\\\\\\\"exit_code\\\\\\\\":[1-9][0-9]*'))
      + if(
          _is_capped,
          length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):'))
            + length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):')),
          arrayCount(
            x -> x ILIKE '%Error:%' OR x ILIKE '%Exception:%',
            _tool_output_lines
          )
        )
    ) AS _error_count

  SELECT
    * EXCEPT (session_date, last_interaction_date, content),
    _session_date as session_date,
    _last_interaction_date as last_interaction_date,
    'codex' as source,
    _input_tokens as input_tokens,
    _output_tokens as output_tokens,
    _cache_read_input_tokens as cache_read_input_tokens,
    toUInt64(0) as cache_creation_input_tokens,
    _input_tokens + _output_tokens as total_tokens,
	    _skills as skills,
	    [] :: Array(String) as slash_commands,
	    _subagent_types as subagent_types,
	    _subagent_count as subagent_count,
	    _native_subagents as native_subagents,
	    toUInt32(length(_interaction_lines)) as total_interactions,
    toUInt32(_duration_min) as actual_duration_min,
    _error_count as error_count,
    multiIf(
      _model_from_turn_context != '', _model_from_turn_context,
      _model_provider != '', _model_provider,
      'unknown'
    ) as model_used,
    ROW_NUMBER() OVER (
      PARTITION BY cs.organization_id, cs.user_id, cs.session_id
      ORDER BY cs.revision DESC
    ) AS _dedupe_rank

  FROM rudel.codex_sessions AS cs
  WHERE _is_capped OR length(_timestamps) > 0
  )
  WHERE _dedupe_rank = 1`;
