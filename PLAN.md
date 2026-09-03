# Plan: Linear Issue Strengthener

## Context

Add a dedicated Flue agent that receives verified Linear `Issue/create` webhooks, inspects the relevant codebase, and strengthens newly created issues into a consistent, implementation-ready format. It should enrich rather than discard the author's intent, reference relevant files/symbols where evidence supports them, and apply controlled Linear labels.

The existing application is a Node-targeted Flue service with a dispatch-only Discord research agent. Linear issue strengthening should be a separate workflow so the current Discord orchestration and reporting behavior remain unchanged.

## Approach

### Event and workflow boundary

- Add the Flue Linear channel and mount it at `/channels/linear`.
- Accept verified `Issue/create` events whose `data.labels` contains the configured `ai:strengthen` name. For `Issue/update`, derive that label's current ID from `data.labels` and compare it with `updatedFrom.labelIds` to detect that it was newly added.
- Resolve the issue's Linear team through trusted application configuration. Dispatch eligible triggers even when no repository is mapped so the agent can leave the requested “no repository available” comment.
- Do not retrigger for unrelated updates or the agent's own title/body/label changes; removing and later re-adding `ai:strengthen` intentionally starts a new strengthening pass.
- Dispatch one durable `IssueStrengthener` conversation per Linear issue and use the `Linear-Delivery` UUID as the idempotency key so delivery retries converge on one submission. Store only the immutable issue ID in `initialData`; carry team/trigger/delivery facts in message attributes and resolve the current repository mapping on each submission.
- Keep the webhook handler fast: validate, decide eligibility from the payload, dispatch, and return without waiting for analysis or external API calls.

### Issue-strengthening agent

- Fetch current issue details through an issue-bound Linear SDK tool rather than relying only on webhook content. Redact likely credentials before returning issue text to the model and use an opaque snapshot digest for conflict detection, so the model never needs to echo raw original content.
- Resolve the authorized GitHub repository from a configured Linear team-to-`owner/repo` mapping; do not allow the model to choose an arbitrary repository.
- If the mapping is absent or GitHub cannot be read, leave the title/body unchanged and post a concise Linear comment that no repository is available; do not attempt a repository-free rewrite.
- Otherwise, give the agent read-only code discovery capabilities sufficient to list paths, search text/symbols, and read previously discovered files; redact common credential formats before file content reaches the model.
- Require a structured output containing:
  - Summary
  - Context and motivation
  - Current behavior
  - Desired behavior
  - Acceptance criteria
  - Relevant code
  - Implementation considerations
  - Testing requirements
  - Open questions
- Preserve meaningful original content and explicitly distinguish repository evidence from inference.
- Improve both the title and description, then publish against the opaque snapshot digest. The write tool re-fetches before backup and immediately before mutation, rejecting stale input.
- On one conflict, fetch the latest issue and regenerate once. On a second conflict, leave the issue unchanged and post a conflict comment for human follow-up.
- Before the successful update, post a comment containing the complete original title/body so no authored content is lost; include a hidden delivery marker so recovery or retries do not duplicate the backup comment.

### Linear write controls

- Expose narrow tools bound to the dispatched issue ID for fetching redacted issue state/team labels, validating and publishing the strengthened issue, and posting repository-unavailable or conflict comments.
- Resolve configured label names to team-specific Linear label IDs in application code.
- Preserve `ai:strengthen`; fetch the team's existing labels and allow the agent to add only IDs from that returned set, never invent, create, rename, or remove labels.
- Publish title, Markdown description, and additive label IDs through the SDK's `updateIssue(...)`; validate all model-selected labels again inside the tool.
- Do not expose a generic Linear API tool or Linear credentials to the model/sandbox.

### Repository access

Use `@octokit/rest` to provide a read-only GitHub application tool layer (`list_repository_files`, `search_repository`, `read_repository_file`) authenticated by a fine-grained token with repository Contents read access and bound to a validated `LINEAR_TEAM_REPOSITORIES` JSON map of team ID to `owner/repo`. Inspect the mapped repository's default branch. This provides enough context for ticket enrichment without granting shell, write, clone, branch selection, or arbitrary repository selection. Namespace discovery/read/failure state by delivery and repository identity; enforce discovery, path, file-size, result-count, UTF-8/binary, and secret-redaction limits in application code; and never expose the GitHub token to the model.

## Files to modify

Expected paths (small helpers may be co-located where this keeps the implementation clearer):

- `package.json` — add `@flue/linear`, `@linear/sdk`, `@octokit/rest`, Vitest, and a `test` script.
- `.env.example` — document Linear credentials, `ai:strengthen`, Linear team-to-GitHub repository mappings, and the read-only GitHub token.
- `src/app.ts` — mount the Linear channel alongside Discord.
- `src/channels/linear.ts` — verify issue webhooks, detect trigger-label transitions, dispatch idempotently, and derive stable issue conversations.
- `src/agents/issue-strengthener.ts` — define initial data, tools, model, issue standard, and completion requirements.
- `src/shared/linear-client.ts` — own the configured Linear SDK client and issue-bound read/publish/comment operations.
- `src/shared/repository-config.ts` — trusted Linear team-to-repository mapping and validation.
- `src/shared/github-client.ts` — authenticated GitHub API client with repository identity bound by trusted configuration.
- `src/tools/repository-read.ts` — constrained read-only GitHub repository listing/search/read tools.
- `src/**/*.test.ts` — unit/integration coverage for pure trigger logic, configuration, repository boundaries, and Linear publishing behavior.
- `README.md` — configuration, Linear webhook setup, trigger-label behavior, permissions, and operational notes.
- `src/observability.ts` — add content-safe lifecycle logging only if Linear-specific outcomes need explicit events beyond existing generic agent/tool observations.

## Reuse

- `src/app.ts` already demonstrates explicit channel mounting with `channel.route()`.
- `src/channels/discord.ts` provides the established pattern for verified channel ingress, `dispatch(...)`, stable channel instance IDs, constrained outbound SDK tools, and error handling.
- `src/agents/orchestrator.ts` provides patterns for Valibot-validated `initialData`, `useInitialData()`, model/tool binding, and enforcing a required final tool action with `useAgentFinish()`.
- `src/db.ts` already provides durable SQLite-backed conversations and submissions.
- `src/observability.ts` already logs generic submission, agent, model, task, and tool lifecycle events without logging sensitive content.

## Steps

- [x] Add and configure the Linear, GitHub, and test dependencies; mount the Linear channel route.
- [x] Implement strict issue payload narrowing; detect create-with-trigger or newly-added-trigger transitions from current and previous label IDs; derive stable issue identity; and apply delivery idempotency.
- [x] Implement trusted Linear team-to-repository configuration.
- [x] Implement token-authenticated, read-only GitHub discovery tools bound to the mapped repository, with ref/path/result/file-size limits and secret/binary exclusions.
- [x] Implement issue-bound Linear operations that fetch the current snapshot and existing team labels, reject unknown label IDs, create an idempotent original-content backup comment, and update title/body with additive labels; wrap the comment/update side effects in deterministic durable steps and retain the hidden delivery marker for external idempotency.
- [x] Implement `IssueStrengthener` with validated immutable issue ID initial data, per-delivery trigger attributes, the current OpenRouter model configuration, the agreed issue standard, evidence rules, and a required terminal action enforced with `useAgentFinish()`.
- [x] Add the one-regeneration conflict path, second-conflict comment, trigger-removal cancellation, and repository-unavailable comment without mutating issue content.
- [x] Document environment variables, required Linear webhook resources/scopes, repository credentials, and deployment setup.
- [x] Add automated coverage for webhook filtering/idempotency, repository authorization, structured output, label restrictions, secret redaction, and publish behavior.

## Verification

- Run `npm run check:types`.
- Run the project test suite added for this integration.
- Build with `npm run build`.
- Send signed fixture deliveries for create-with-trigger, create-without-trigger, trigger-label addition, unrelated update, agent-authored update, trigger removal/re-addition, and duplicate delivery.
- Confirm the eligible create returns promptly and results in exactly one durable submission.
- Confirm repository tools can inspect only the mapped repository and cannot write files, select another repository, or expose credentials.
- Confirm generated issue content follows the agreed structure, retains the original intent, and cites only code paths actually discovered.
- Confirm only existing labels returned for the issue's team can be applied, no label is created, and rerunning does not duplicate labels/comments.
- Simulate one human edit and verify the agent regenerates against it; simulate a second edit and verify it aborts with a conflict comment.
- Verify an absent mapping and a GitHub read failure leave title/body untouched and post the repository-unavailable comment.
- Perform an end-to-end test with a real Linear test issue and verify the audit trail and loop prevention.

## Resolved decisions

- Linear teams map to GitHub `owner/repo` entries through validated application configuration; repository access uses a fine-grained read-only token and the default branch.
- `ai:strengthen` triggers on issue creation or when added later.
- Successful runs replace title/body, back up the original content in a comment, and only add labels that already exist for the Linear team.
- Missing/unreadable repositories do not produce a partial rewrite; they produce a Linear comment and leave the issue unchanged.
- One concurrent edit causes a refresh/regeneration; a second conflict aborts with a comment.
