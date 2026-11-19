// Choices the app already knows, for forms that should suggest rather than ask you to type from memory.

/**
 * Client names in use, for the Client boxes (New project, Connectors): from the projects this device lists, plus the
 * one-line client summaries a device that isn't a work device gets. One entry per name (case-insensitive), sorted.
 */
export function clientNames(projects: readonly { client?: string | null }[], lines: readonly { client: string }[] = []): string[] {
  const seen = new Map<string, string>();
  for (const name of [...projects.map((p) => p.client ?? ''), ...lines.map((l) => l.client)]) {
    const n = name.trim();
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Projects for a picker: by name, one per slug, sorted by name. */
export function projectChoices<T extends { slug: string; name: string }>(projects: readonly T[]): T[] {
  const seen = new Set<string>();
  return projects.filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true))).sort((a, b) => a.name.localeCompare(b.name));
}
