/** Canonical ids contain ":" (e.g. "clickup:cu-101"), so every id and name in a path is encoded. */
export const personHref = (personId: string): string => `/people/${encodeURIComponent(personId)}`;
export const itemHref = (itemId: string): string => `/items/${encodeURIComponent(itemId)}`;
export const departmentHref = (team: string): string => `/departments/${encodeURIComponent(team)}`;
/** The company-wide view at a given list length; the default length (5) needs no parameter. */
export const companyTopHref = (top: number): string => (top === 5 ? "/" : `/?top=${top}`);
export const homeHref = (team?: string | null): string => (team ? `/?dept=${encodeURIComponent(team)}` : "/");

/** Route params arrive percent-decoded or not depending on the path; decoding an already-decoded id (no "%") is a no-op. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
