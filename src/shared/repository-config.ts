export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

const repositoryName = /^[A-Za-z0-9_.-]+$/;

export function parseTeamRepositoryMap(
  value: string | undefined,
): ReadonlyMap<string, readonly GitHubRepositoryRef[]> {
  if (!value?.trim()) return new Map();

  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("LINEAR_TEAM_REPOSITORIES must be valid JSON.");
  }

  if (!isRecord(input) || Array.isArray(input)) {
    throw new Error(
      "LINEAR_TEAM_REPOSITORIES must be a JSON object mapping team IDs to owner/repo strings or arrays.",
    );
  }

  const entries = Object.entries(input).map(([teamId, configured]) => {
    if (!teamId.trim()) {
      throw new Error("LINEAR_TEAM_REPOSITORIES contains an empty team ID.");
    }
    const values = typeof configured === "string" ? [configured] : configured;
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every((repository) => typeof repository === "string")
    ) {
      throw new Error(
        "LINEAR_TEAM_REPOSITORIES must map each team ID to an owner/repo string or non-empty array of owner/repo strings.",
      );
    }
    const repositories = values.map(parseRepository);
    const unique = new Map(
      repositories.map((ref) => [repositoryIdentity(ref).toLowerCase(), ref] as const),
    );
    return [teamId, [...unique.values()]] as const;
  });

  return new Map(entries);
}

export function repositoriesForTeam(
  teamId: string,
  value = process.env.LINEAR_TEAM_REPOSITORIES,
): readonly GitHubRepositoryRef[] {
  return parseTeamRepositoryMap(value).get(teamId) ?? [];
}

export function repositoryIdentity(ref: GitHubRepositoryRef): string {
  return `${ref.owner}/${ref.repo}`;
}

export function repositoryStateNamespace(
  refs: readonly GitHubRepositoryRef[],
): string {
  if (refs.length === 0) return "unmapped";
  return encodeURIComponent(
    refs
      .map((ref) => repositoryIdentity(ref).toLowerCase())
      .sort()
      .join(","),
  );
}

export function parseRepository(value: string): GitHubRepositoryRef {
  const parts = value.trim().split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !repositoryName.test(parts[0]) ||
    !repositoryName.test(parts[1])
  ) {
    throw new Error(`Invalid GitHub repository mapping: ${value}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
