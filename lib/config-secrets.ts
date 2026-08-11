const publishedExampleSecrets: Readonly<Record<string, string>> = {
  SHED_BOOTSTRAP_TOKEN: "replace-with-a-different-long-random-secret",
  SHED_DISPLAY_TOKEN: "replace-with-a-separate-long-random-secret",
};

/**
 * Example values are useful in a template, but they must never become live
 * credentials. Keep this check at the application boundary as defense in
 * depth: the Docker entrypoint rejects them too, while other deployment paths
 * may not use that entrypoint.
 */
export function isPublishedExampleSecret(name: string, value: string): boolean {
  return publishedExampleSecrets[name] === value;
}

export function configuredBinding(name: string, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || isPublishedExampleSecret(name, cleaned)) return undefined;
  return cleaned;
}
