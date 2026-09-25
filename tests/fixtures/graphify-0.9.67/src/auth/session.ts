export function createSession(user: string): string {
  return `session:${user}`;
}
