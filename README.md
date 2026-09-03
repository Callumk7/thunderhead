# thunderhead

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
```

Then copy `.env.example` to `.env` and configure the integrations you use. Keep `.env` private; it is gitignored. Discord research orchestration uses `OPENROUTER_API_KEY`, `EXA_API_KEY`, `DISCORD_PUBLIC_KEY`, and `DISCORD_BOT_TOKEN`. Linear issue strengthening additionally requires `LINEAR_WEBHOOK_SECRET`, `LINEAR_API_KEY`, `GITHUB_TOKEN`, and `LINEAR_TEAM_REPOSITORIES`.

Both agents are dispatch-only. Work enters through verified Discord interactions or verified Linear webhooks; neither agent has a directly accessible route.

## Develop

```sh
npm run dev
```

Discord interactions are accepted at `http://localhost:8000/channels/discord/interactions`. There is no directly accessible agent route.

Research requests are split across parallel researcher subagents using Exa, independently audited by a fact-checker, and returned with source URLs and uncertainty labels. Discord displays one live job-status message as work moves through researching, verifying, writing, and completion; terminal failures update the same message.

Linear issue events are accepted at `http://localhost:8000/channels/linear/webhook`. New issues carrying `ai:strengthen`, or existing issues to which that label is newly added, start a separate issue-strengthening workflow.

## Discord setup

Create a Discord application command named `/orchestrate` with one required string option, then configure its Interactions Endpoint URL as:

```txt
https://your-host.example/channels/discord/interactions
```

The bot needs permission to send messages in the configured channels.

## Linear issue strengthening

### Behavior

1. Create the `ai:strengthen` label in Linear.
2. Add the label while creating an issue, or add it to an existing issue.
3. Thunderhead maps the issue's Linear team to one or more GitHub repositories and inspects their default branches through read-only API tools. Publishing remains unavailable until at least one discovered file from every mapped repository has been read successfully.
4. It replaces the issue title and description with an implementation-ready version containing summary, context, behavior, acceptance criteria, relevant code, implementation/testing notes, and open questions. The write tool validates that structure and its acceptance-criteria checkboxes before changing Linear.
5. Before replacement, it posts the exact original title and body in a marked Linear comment. It only adds labels that already exist for the issue's team; it never creates, removes, or renames labels.

If no repository is mapped, the token is unavailable, or GitHub cannot read the repository, Thunderhead leaves the issue unchanged and posts a repository-unavailable comment. If a person edits the issue during analysis, Thunderhead refreshes and regenerates once; a second conflict leaves the issue unchanged and posts a conflict comment.

Removing `ai:strengthen` while work is running cancels publication. Removing and later re-adding it intentionally starts another pass. Other issue updates, including Thunderhead's own title/body/label update, do not trigger the workflow.

### Configuration

Configure a Linear webhook for the **Issues** resource and point it to:

```txt
https://your-host.example/channels/linear/webhook
```

Set these variables:

```env
LINEAR_WEBHOOK_SECRET=...
LINEAR_API_KEY=...
LINEAR_TRIGGER_LABEL=ai:strengthen
LINEAR_TEAM_REPOSITORIES='{"single-repo-team-uuid":"github-owner/repository","multi-repo-team-uuid":["github-owner/frontend","github-owner/backend"]}'
GITHUB_TOKEN=...
```

`LINEAR_ORGANIZATION_ID` and `LINEAR_WEBHOOK_ID` can optionally restrict accepted deliveries to one organization and configured webhook. The Linear credential needs permission to read issues/team labels, update issues, and create comments. For a single workspace this implementation uses a personal Linear API key; an installed multi-workspace application should replace it with organization-specific OAuth token storage.

Use a fine-grained GitHub token scoped only to mapped repositories with read-only **Contents** access (and GitHub's required metadata access). Do not grant repository write access. Each team mapping accepts either one `owner/repo` string or an array of strings. Repository identities come only from the trusted `LINEAR_TEAM_REPOSITORIES` JSON object; model-selected repository names and refs are not accepted. Repository authorization state is namespaced by delivery and the complete mapped repository set. Code search, file reads, and directory listings enforce discovery, query, path, UTF-8/binary, result-count, and file-size limits. Common credential formats are redacted from both Linear input and repository files before content reaches the model, proposed Linear output containing those formats is rejected, and conflict checks use an opaque snapshot digest rather than requiring the model to echo original content.

Linear requires a public HTTPS webhook and a `200` response within five seconds. The handler only verifies, filters, and durably dispatches work before responding. The `Linear-Delivery` UUID is used as the Flue idempotency key, and marked comments prevent duplicate backup/failure comments during recovery.

### Issue standard

Strengthened descriptions use these sections:

```md
## Summary
## Context and motivation
## Current behavior
## Desired behavior
## Acceptance criteria
## Relevant code
## Implementation considerations
## Testing requirements
## Open questions
```

Acceptance criteria use Markdown checkboxes and describe observable outcomes. Repository paths and symbols must be verified through GitHub; unknown details are recorded as `Not established` rather than invented.

The publisher re-fetches immediately before backing up and again immediately before updating to detect concurrent edits. Linear's update API does not provide an expected-version condition, so a very small race remains between that final check and the mutation; the original-content comment and Linear's issue history provide the audit/recovery path.

## Deploy

```sh
npm run build
sudo systemctl restart thunderhead
```

The included `thunderhead.service` loads secrets from `/home/exedev/thunderhead/.env` and serves on port 8000.
The server writes content-safe, one-line JSON lifecycle logs to stdout/stderr. With systemd, follow them using:

```sh
journalctl -u <service-name> -f -o cat
```

Logs include submissions, model turns, Exa searches, subagent tasks, tools, failures, token usage, and estimated model cost. Prompts, tool arguments, issue content, repository file contents, research results, and secrets are intentionally omitted.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
