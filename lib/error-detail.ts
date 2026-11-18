/** A short "(TypeError: message)" tag for 503 responses, so a failure shows which step broke without exposing a stack. */
export function errorDetail(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "Error";
  const message = (cause instanceof Error ? cause.message : String(cause)).replace(/\s+/g, " ").slice(0, 120);
  return ` (${name}: ${message})`;
}
