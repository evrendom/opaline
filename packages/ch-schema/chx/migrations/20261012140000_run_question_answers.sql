-- Run question answers (CONTEXT.md "Run question"): the probability of yes
-- per question wording and run, keyed by workspace, question, run, the
-- transcript revision it was given for and the provider and model version
-- that answered (so providers can be compared). Written only by the API's run
-- question worker after it finds no answer stored for the key; a retried
-- write of the same key is collapsed by answered_at, and readers keep the
-- newest row per key. Kept until the account or workspace purge deletes it. Applied by scripts/migrate-run-question-answers.ts.

CREATE TABLE IF NOT EXISTS rudel.run_question_answers
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'The member who uploaded the session the run belongs to.',
  `session_id` String COMMENT 'Session of the run.',
  `agent_id` String COMMENT 'Stream of the run: empty for the main transcript, else the subagent.',
  `turn_idx` UInt32 COMMENT 'The run within its stream, as in runs.turn_idx.',
  `revision` UInt64 COMMENT 'Transcript revision (generation) of the session the answer was given for; run_answers shows an answer only while its session is committed at this revision.',
  `question_id` String COMMENT 'The run question, one wording; a reworded question has a new id.',
  `question` String COMMENT 'The wording the answer answered.',
  `probability` Float32 COMMENT 'Probability (0 to 1) that the answer to the question is yes.',
  `provider` LowCardinality(String) COMMENT 'Who answered: the provider as configured (e.g. subq, jev, subq:run for whole runs); part of the key, so providers can answer the same question side by side.',
  `input` LowCardinality(String) COMMENT 'What the provider read: run (the run''s whole text, secret-filtered) or note (the compact run note, sent when the run is larger than the provider takes or the provider reads notes).',
  `model` LowCardinality(String) COMMENT 'The model version that answered, as the provider reported it.',
  `cost_usd` Float64 COMMENT 'What the answer cost: its share of the call that answered every question about the run.',
  `answered_at` DateTime64(3, 'UTC') COMMENT 'UTC time the answer was stored.'
) ENGINE = ReplacingMergeTree(answered_at)
PRIMARY KEY (`organization_id`, `question_id`, `session_id`, `agent_id`, `turn_idx`, `revision`, `provider`, `model`)
ORDER BY (`organization_id`, `question_id`, `session_id`, `agent_id`, `turn_idx`, `revision`, `provider`, `model`)
SETTINGS index_granularity = 8192, storage_policy = 's3'
COMMENT 'Run question answers: the probability of yes per question wording and run; written only by the API''s run question worker.';
