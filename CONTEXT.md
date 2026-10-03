# Agent analysis

Opaline lets agents (in the Codex plugin, the in-app Home agent, or a scheduled job) analyse a team's uploaded Claude Code and Codex sessions to find what makes agentic engineering slow, expensive or wrong, with evidence, and to keep those analyses for later reuse.

## Language

**Workspace**:
A team in Opaline; its members' uploaded sessions are what gets analysed.
_Avoid_: organization (in ClickHouse `organization_id` historically means the uploading user)

**Member**:
A person in a workspace; may read only their own sessions.

**Admin**:
A member who may read every member's sessions in the workspace.

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

## Relationships

- A **Session** belongs to exactly one **Member**; a **Run** belongs to exactly one **Session**
- An **Analysis** has one author and covers only **Sessions** its author may read
- An **Analysis** has ordered **Steps**; a **Step** may follow from an earlier **Step** and is answered by **Queries** or by the asker's reply
- An **Update** points to the **Analysis** it updates; the earlier one stays as it was
- An **Analysis** links to at most one **Analysis session**, which supplies its **Analysis cost**
- Deleting a **Member**'s account deletes their **Analyses** and every **Analysis** that read one of their **Sessions**; deleting a **Workspace** deletes all its **Analyses**
- A shared **Analysis** shows its steps, final answer and stored **Query** results to the workspace, including results drawn from other **Members**' **Sessions**; a workspace can opt into restricting each result to **Admins** and, when every **Session** it read is theirs, that **Member**, even if the result names none of the other **Sessions**

## Example dialogue

> **Member:** "Can I see the analysis my lead ran on why our agents fail?"
> **Domain expert:** "Yes, once they share it — you'll see the steps and the answer, but you can only open the quoted runs that are yours."

## Flagged ambiguities

- "organization" means a workspace in Postgres but the uploading user in ClickHouse's `organization_id` — resolved: say **Workspace** for the team.
