/** Generate a UUID v4 for use as a database primary key (offline, no round-trip). */
export function newId(): string {
  return crypto.randomUUID();
}
