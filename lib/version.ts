export function versionFromCommitSha(commitSha: string | undefined) {
  return commitSha?.trim() ? commitSha.trim().slice(0, 7) : "local";
}
