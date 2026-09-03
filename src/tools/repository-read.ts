import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { createGitHubClient, getDefaultBranch } from "../shared/github-client.ts";
import {
  repositoryIdentity,
  type GitHubRepositoryRef,
} from "../shared/repository-config.ts";
import { redactPotentialSecrets } from "../shared/secret-redaction.ts";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 30;
const MAX_FILE_BYTES = 100_000;

interface RepositoryReadToolOptions {
  discoveredPaths: readonly string[];
  recordDiscovered(paths: readonly string[]): void;
  recordSuccess(kind: "discovery" | "file", repository: string): void;
  recordFailure(): void;
}

export function repositoryReadTools(
  refs: readonly GitHubRepositoryRef[],
  options: RepositoryReadToolOptions,
) {
  if (refs.length === 0) throw new Error("At least one mapped repository is required.");
  const repositoryByIdentity = new Map(
    refs.map((ref) => [repositoryIdentity(ref).toLowerCase(), ref] as const),
  );
  const repositories = refs.map(repositoryIdentity);
  const discoveredPaths = new Set(options.discoveredPaths);
  const selectRepository = (value: string) => {
    const ref = repositoryByIdentity.get(value.toLowerCase());
    if (!ref) throw new Error("Repository is outside the Linear team's allowed mapping.");
    return { ref, repository: repositoryIdentity(ref) };
  };

  return [
    defineTool({
      name: "list_repository_files",
      description: `List files and directories on a mapped repository's default branch. Choose only one of: ${repositories.join(", ")}.`,
      input: v.object({
        repository: v.string(),
        path: v.optional(v.pipe(v.string(), v.maxLength(500))),
      }),
      async run({ data }) {
        const { ref, repository } = selectRepository(data.repository);
        const path = normalizeAndValidatePath(data.path ?? "");
        return withGitHubAvailability(options, "discovery", repository, async () => {
          const client = createGitHubClient();
          const branch = await getDefaultBranch(client, ref);
          const response = await client.rest.repos.getContent({
            owner: ref.owner,
            repo: ref.repo,
            path,
            ref: branch,
          });
          if (!Array.isArray(response.data)) {
            throw new Error(`${path || "."} is not a directory.`);
          }
          const entries = response.data
            .filter((entry) => isAllowedPath(entry.path))
            .slice(0, MAX_DIRECTORY_ENTRIES)
            .map((entry) => ({
              name: entry.name,
              path: entry.path,
              type: entry.type,
            }));
          options.recordDiscovered(
            entries.map(({ path: entryPath }) => discoveredPath(repository, entryPath)),
          );
          return {
            output: {
              repository,
              branch,
              path: path || ".",
              entries,
              truncated: response.data.length > entries.length,
            },
          };
        });
      },
    }),
    defineTool({
      name: "search_repository",
      description: `Search for literal code or identifiers in one mapped repository. Choose only one of: ${repositories.join(", ")}.`,
      input: v.object({
        repository: v.string(),
        query: v.pipe(v.string(), v.minLength(2), v.maxLength(100)),
      }),
      async run({ data }) {
        const { ref, repository } = selectRepository(data.repository);
        const query = validateSearchQuery(data.query);
        return withGitHubAvailability(options, "discovery", repository, async () => {
          const client = createGitHubClient();
          const response = await client.rest.search.code({
            q: `\"${query}\" repo:${repository}`,
            per_page: MAX_SEARCH_RESULTS,
          });
          const matches = response.data.items
            .filter((item) => isAllowedPath(item.path))
            .map((item) => ({ path: item.path, url: item.html_url }));
          options.recordDiscovered(
            matches.map(({ path }) => discoveredPath(repository, path)),
          );
          return {
            output: {
              repository,
              query,
              matches,
              totalCount: response.data.total_count,
              incomplete: response.data.incomplete_results,
            },
          };
        });
      },
    }),
    defineTool({
      name: "read_repository_file",
      description: `Read one text file previously discovered in the same mapped repository. Choose only one of: ${repositories.join(", ")}. Potential credentials are redacted.`,
      input: v.object({
        repository: v.string(),
        path: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
      }),
      async run({ data }) {
        const { ref, repository } = selectRepository(data.repository);
        const path = normalizeAndValidatePath(data.path);
        if (!discoveredPaths.has(discoveredPath(repository, path))) {
          throw new Error("List or search for this exact path before reading it.");
        }
        return withGitHubAvailability(options, "file", repository, async () => {
          const client = createGitHubClient();
          const branch = await getDefaultBranch(client, ref);
          const response = await client.rest.repos.getContent({
            owner: ref.owner,
            repo: ref.repo,
            path,
            ref: branch,
          });
          if (Array.isArray(response.data) || response.data.type !== "file") {
            throw new Error(`${path} is not a file.`);
          }
          if (response.data.size > MAX_FILE_BYTES) {
            throw new Error(`${path} exceeds the ${MAX_FILE_BYTES}-byte read limit.`);
          }
          if (response.data.encoding !== "base64" || !response.data.content) {
            throw new Error(`${path} cannot be read as inline text content.`);
          }
          const content = Buffer.from(response.data.content, "base64").toString("utf8");
          if (
            Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES ||
            content.includes("\0") ||
            content.includes("\uFFFD")
          ) {
            throw new Error(`${path} is too large or is not a UTF-8 text file.`);
          }
          const safe = redactPotentialSecrets(content);
          return {
            output: {
              repository,
              branch,
              path,
              content: safe.content,
              redacted: safe.redacted,
            },
          };
        });
      },
    }),
  ] as const;
}

async function withGitHubAvailability<T>(
  options: RepositoryReadToolOptions,
  kind: "discovery" | "file",
  repository: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    options.recordSuccess(kind, repository);
    return result;
  } catch (error) {
    options.recordFailure();
    throw error;
  }
}

function discoveredPath(repository: string, path: string): string {
  return `${repository.toLowerCase()}:${path}`;
}

export function normalizeAndValidatePath(input: string): string {
  const path = input.trim().replace(/^\.\//, "");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === ".." || segment === ".") ||
    !isAllowedPath(path)
  ) {
    throw new Error("Repository path is outside the allowed read boundary.");
  }
  return path;
}

export function isAllowedPath(path: string): boolean {
  const segments = path.toLowerCase().split("/").filter(Boolean);
  return !segments.some((segment) => {
    return (
      segment === ".git" ||
      segment === ".ssh" ||
      segment === ".docker" ||
      segment === ".kube" ||
      segment === ".npmrc" ||
      segment === ".pypirc" ||
      segment === ".netrc" ||
      segment === "credentials" ||
      segment === "id_rsa" ||
      segment === "id_dsa" ||
      segment === "kubeconfig" ||
      /^service[-_.]?account(?:\.|$)/.test(segment) ||
      segment.startsWith(".env") ||
      /(?:^|[._-])(secret|secrets|credential|credentials)(?:[._-]|$)/.test(segment) ||
      /\.(?:pem|key|p12|pfx|keystore|jks)$/.test(segment)
    );
  });
}

export function validateSearchQuery(input: string): string {
  const query = input.trim();
  if (
    query.length < 2 ||
    /[\r\n\"]/.test(query) ||
    /(?:^|\s)(?:repo|org|user):/i.test(query) ||
    /\b(?:OR|AND|NOT)\b/.test(query)
  ) {
    throw new Error("Use one literal search term without GitHub query operators.");
  }
  return query;
}
