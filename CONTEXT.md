# Agent analysis

Opaline lets agents (in the Codex plugin, the in-app Home agent, or a scheduled job) analyse a team's uploaded Claude Code and Codex sessions to find what makes agentic engineering slow, expensive or wrong, with evidence, and to keep those analyses for later reuse.

## Language

**Workspace**:
A team in Opaline; its members' uploaded sessions are what gets analysed.
_Avoid_: organization (in ClickHouse `organization_id` historically means the uploading user)

**Member**:
A person in a workspace; may read every member's sessions and setup, personal setup included, so the team learns from all of its sessions.

**Admin**:
A member who manages the workspace and its members; reads no more than any other member.

**Session**:
One uploaded Claude Code or Codex transcript, owned by the member who uploaded it.

**Run**:
One human prompt and everything the agent did until the next prompt, within one stream (the main transcript or one subagent).
_Avoid_: turn (the storage term), exchange (a view of a run)

**Analysis**:
One question a person asked about sessions, the steps an agent took to answer it, and the final answer it gave. Owned by its author and private to them until shared with the workspace. It starts with the agent's first query and is **finished** once it has a final answer; otherwise it stays **unfinished** but keeps its steps and queries.
_Avoid_: report, insight

**Author**:
The person an analysis belongs to and whose read permissions it runs with; a scheduled analysis is authored by the person who scheduled it.

**Host**:
Where an analysis was run: the Codex plugin, the Home agent, the CLI, a scheduled job, or an evaluation; evaluation analyses are kept but left out of searches.

**Step**:
A sub-question on the path to an analysis's final answer, written out by the agent, answered either by queries or by the person who asked; it ends in a finding and may lead to further steps. Never the agent's hidden reasoning.

**Query**:
One call an agent made to find or read evidence, with its exact arguments and exact result.

**Finding**:
What a step concluded, in a sentence or two, as the agent stated it.

**Analysis session**:
An uploaded agent session that carried out an analysis; left out of analyses by default so analyses do not count their own quotes.

**Analysis cost**:
The exact tokens (and their price) an analysis used, taken from its uploaded analysis session; recorded for unfinished analyses too, and left missing, never estimated, when that session was not uploaded.

**Scope**:
The sessions an analysis covers: a date range plus filters (repository, agent, model, member).

**Cutoff**:
The newest data an analysis saw; anything uploaded after it is new to that analysis.

**Update**:
An analysis that starts from an earlier analysis of the same question and processes only what changed since its cutoff, stating what changed.
_Avoid_: rerun, refresh

**Setup**:
Everything other than the prompt that steers an agent: instruction files, skills, hooks, permission and MCP settings, scripts, lint and CI configuration, and the docs the instructions point to. Repository setup lives in the repository; personal setup lives in the member's home directory.
_Avoid_: config, environment (a failure kind in `find source=tool`)

**Setup file**:
One file of setup, named by where it lives rather than by a machine path: a repository and the path inside it, a plugin and the path inside it, or a member's home and the path inside it. The same setup file on two teammates' machines is one setup file.
_Avoid_: skill name or file name alone (two setup files can share one)

**Setup file version**:
One exact content of a setup file. Two runs used the same version only when the content is identical; uncommitted edits are a version of the same setup file, marked as uncommitted and named after the member whose checkout holds them.

**Received setup**:
The setup text the agent actually received in a run, as its transcript records it, each piece tied to its setup file and setup file version. Setup the transcript does not record is unknown, never filled in from disk.
_Avoid_: loaded context

**Setup snapshot**:
The setup a session ran under at one moment, taken from its member's checkout, uncommitted changes included. It is the evidence only for setup the agent acts under without receiving it as text: permission settings, hooks, CI and lint configuration, scripts.
_Avoid_: capture (the evidence it is built from)

**Re-ask**:
A prompt that asks again, in the same session, for what an earlier prompt asked, because the agent did not get it done; a sign the agent lacked context or know-how.
_Avoid_: retry (the agent's own retries), repeated prompt

**Frustration**:
A member's prompt that pushes back on what the agent just did: annoyance, complaints, swearing at the work, saying it still does not work, or a correction, even a calm one ("no, the other file", "that's not what I meant"). A short verdict on its own counts by its meaning: "worse", "still" or "and?" count; "ok", "good" or "fine" never do. Swearing that praises ("damn good") is not frustration. Only the member's own words count, never quoted, pasted or code text.
_Avoid_: unhappy, negative, sentiment

**Recurring request**:
The same kind of request made across many sessions, often by several members.
_Avoid_: repeated prompt

**Impact**:
What a group of runs cost the team, as separate measures: active time, cost, frustration, re-asks, runs and members. Never one combined score; the agent answering picks the order that fits the question and says which it used. A group's time is shown two ways, the time of the runs that contain it and the time of its own calls, and neither is time lost to it until those runs are read.
_Avoid_: score, severity

**Approved measure**:
One impact measure defined once for every analysis, so two analyses never compute it differently: active time, cost, tokens, re-asks, frustration, runs, members, and a group's time two ways. `schema` lists them. Frustration is a next prompt that reads as frustration (see Frustration); until the meaning of a re-ask is settled, a re-ask is such a prompt right after a run whose final message said it was done.
_Avoid_: metric, KPI

**Run question**:
A yes/no question about a run ("Did the agent struggle to find the right file?"), answered by SubQ Snap (Jev as a fallback) as the probability of yes, from the run's full text (secret-filtered; the compact run note when the run is too large). In a workspace that has run questions, every run is answered for every question that is on as soon as it is indexed, so answers are facts; agents ask only about runs without answers. Opaline sets the run questions; workspaces do not write or remove them. Changing a question's wording makes it a new question; earlier answers keep the wording they answered. Where a workspace has run questions, the dashboard shows each question answered yes as a tag on the run in the reader and on the session in the sessions list, by the short tag name Opaline gives the question (else its wording cut short); the tag name is not part of the wording and changes in place.
_Avoid_: question (an analysis's question), label, signal

**Run view**:
The compact, expandable view of one run: how it ended, the runs before and after it, and its phases with their time and tokens, each part with an id the agent can expand. Made of sections that can be added, removed or asked for one by one; every section reads data the agent could also query directly.
_Avoid_: digest, transcript dump

**Phase**:
A stretch of consecutive requests in a run doing the same kind of work: exploring, editing, running checks, git and CI, or talking to the user.
_Avoid_: step (an analysis's sub-question)

**Request**:
One model response and the tool calls it made; the smallest part of a run with its own time and tokens.

**Call**:
One tool call the agent made; it has a duration but no tokens of its own.

**Moment**:
A run made noticeable by one or more flags: deterministic checks over the run's records, such as long searching before the first edit, a cost or duration among the range's top, one file edited again and again, a failing streak, CI failing, work reverted with git, denied calls, an interruption, a compaction, the agent apologizing, or the member's next prompt reading frustrated. Each flag points at a range of the run's records. Flags are rules a workspace can turn off or tune, never a model's judgement, except that the frustration flag also counts SubQ's yes/no answer about the next prompt; whether it was real friction is the observation's call.
_Avoid_: incident, issue, finding (an analysis's answer)

**Observation**:
What a model wrote about one noticeable run after reading only its flagged records: what happened, the records that show it, the layer a fix belongs to, and one concrete lesson. Made on a member's request and kept; an observation can say the rule matched normal work.
_Avoid_: summary, insight

**Pattern**:
Observations of a range that say the same thing within one layer, grouped by their words. A team can record the fix it made against a pattern and see how often the pattern happens since.
_Avoid_: cluster, theme

## Relationships

- A **Session** belongs to exactly one **Member**; a **Run** belongs to exactly one **Session**
- An **Analysis** has one author and covers only **Sessions** its author may read
- An **Analysis** has ordered **Steps**; a **Step** may follow from an earlier **Step** and is answered by **Queries** or by the asker's reply
- A **Session** has zero or more **Setup snapshots** (taken when it starts, resumes, checkpoints and ends); a finding about why a run went wrong cites the snapshot that run ran under, never a local checkout
- **Re-asks** and **Recurring requests** both mark runs a skill might have helped; which fix fits is decided only after reading those runs
- A **Run** is a **Moment** when at least one flag marks it; it has at most one current **Observation**; a **Pattern** groups **Observations**, never **Moments** directly
- A **Run question**'s answer only says where to read; a finding needs the runs read, never the probabilities alone
- An **Update** points to the **Analysis** it updates; the earlier one stays as it was
- An **Analysis** links to at most one **Analysis session**, which supplies its **Analysis cost**
- Deleting a **Member**'s account deletes their **Analyses** and every **Analysis** that read one of their **Sessions**; deleting a **Workspace** deletes all its **Analyses**
- A shared **Analysis** shows its steps, final answer and stored **Query** results to the workspace, including results drawn from other **Members**' **Sessions**; a workspace limited to own sessions can restrict each result to **Admins** and, when every **Session** it read is theirs, that **Member**

## Example dialogue

> **Member:** "Can I see the analysis my lead ran on why our agents fail?"
> **Domain expert:** "Yes, once they share it — you'll see the steps, the answer and every run it quotes, whoever's session it came from."

## Flagged ambiguities

- "organization" means a workspace in Postgres but the uploading user in ClickHouse's `organization_id` — resolved: say **Workspace** for the team.
