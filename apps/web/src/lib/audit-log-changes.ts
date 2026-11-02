export interface AuditFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

type SnapshotRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SnapshotRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenSnapshot(value: unknown): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  if (value === null || value === undefined) return fields;

  const pending: { path: string[]; value: unknown }[] = [
    { path: [], value },
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    if (isRecord(current.value)) {
      const entries = Object.entries(current.value);
      if (entries.length === 0) {
        if (current.path.length > 0) {
          fields.set(current.path.join("."), current.value);
        }
        continue;
      }

      for (const [key, nestedValue] of entries) {
        pending.push({
          path: [...current.path, key],
          value: nestedValue,
        });
      }
      continue;
    }

    fields.set(current.path.join("."), current.value);
  }

  return fields;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];

  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) continue;
    const [currentLeft, currentRight] = pair;

    if (Object.is(currentLeft, currentRight)) continue;
    if (Array.isArray(currentLeft) && Array.isArray(currentRight)) {
      if (currentLeft.length !== currentRight.length) return false;
      for (let index = 0; index < currentLeft.length; index += 1) {
        pending.push([currentLeft[index], currentRight[index]]);
      }
      continue;
    }

    if (isRecord(currentLeft) && isRecord(currentRight)) {
      const leftKeys = Object.keys(currentLeft);
      const rightKeys = Object.keys(currentRight);
      if (
        leftKeys.length !== rightKeys.length ||
        leftKeys.some((key) => !Object.hasOwn(currentRight, key))
      ) {
        return false;
      }
      for (const key of leftKeys) {
        pending.push([currentLeft[key], currentRight[key]]);
      }
      continue;
    }

    return false;
  }

  return true;
}

function humanizeSegment(segment: string): string {
  return segment
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeEnum(value: string): string {
  return /^[A-Z][A-Z\d]*(?:_[A-Z\d]+)*$/.test(value)
    ? value
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : value;
}

export function formatAuditFieldName(path: string): string {
  if (!path) return "Details";
  return path.split(".").map(humanizeSegment).join(" · ");
}

export function formatAuditFieldValue(value: unknown): string {
  function format(currentValue: unknown, depth: number): string {
    if (currentValue === null || currentValue === undefined) return "Not set";
    if (typeof currentValue === "string") {
      return currentValue.length === 0 ? "Not set" : humanizeEnum(currentValue);
    }
    if (typeof currentValue === "boolean") return currentValue ? "Yes" : "No";
    if (typeof currentValue === "number") return String(currentValue);
    if (depth >= 8) return "Complex value";
    if (Array.isArray(currentValue)) {
      return currentValue.length === 0
        ? "No values"
        : currentValue
            .map((item) => format(item, depth + 1))
            .join(", ");
    }
    if (isRecord(currentValue)) {
      const entries = Object.entries(currentValue);
      return entries.length === 0
        ? "No values"
        : entries
            .map(
              ([key, nestedValue]) =>
                `${humanizeSegment(key)}: ${format(nestedValue, depth + 1)}`,
            )
            .join(" · ");
    }
    return "Complex value";
  }

  return format(value, 0);
}

export function getAuditFieldChanges(
  before: unknown,
  after: unknown,
): AuditFieldChange[] {
  const beforeFields = flattenSnapshot(before);
  const afterFields = flattenSnapshot(after);
  const paths = new Set([...beforeFields.keys(), ...afterFields.keys()]);

  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .filter(
      (path) =>
        !valuesEqual(
          beforeFields.get(path) ?? null,
          afterFields.get(path) ?? null,
        ),
    )
    .map((path) => ({
      field: formatAuditFieldName(path),
      before: beforeFields.has(path) ? beforeFields.get(path) : null,
      after: afterFields.has(path) ? afterFields.get(path) : null,
    }));
}
