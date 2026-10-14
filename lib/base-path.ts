/** Base path the app is served under (see next.config.ts). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * Prefix an app-relative API path with the base path.
 * Next.js prefixes <Link> and router navigation, but not fetch(): without this,
 * fetch("/api/...") on the live domain hits the parent site instead of this app.
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(BASE_PATH + "/"))) return path;
  return BASE_PATH + path;
}
