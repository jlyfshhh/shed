export function normalizedEmptyValue(resource: string, key: string): "" | null {
  return (resource === "animal" && key === "location")
    || (resource === "schedule" && key === "details")
    ? ""
    : null;
}
