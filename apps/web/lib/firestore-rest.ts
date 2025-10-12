// apps/web/lib/firestore-rest.ts
export type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | { arrayValue: { values?: FsValue[] } };

function toFsValue(v: string | number | boolean | null): FsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  return { booleanValue: v };
}

// --- env 取得
function getProject() {
  const projectId = process.env.NEXT_PUBLIC_FB_PROJECT_ID!;
  const apiKey = process.env.NEXT_PUBLIC_FB_API_KEY!;
  if (!projectId || !apiKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_FB_PROJECT_ID / NEXT_PUBLIC_FB_API_KEY"
    );
  }
  return { projectId, apiKey };
}

/** Firestore Value → JS Value（再帰デコード） */
export function fsDecode(v?: FsValue): unknown {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fsDecode);
  if ("mapValue" in v) {
    const out: Record<string, unknown> = {};
    const fields = v.mapValue.fields ?? {};
    for (const k of Object.keys(fields)) out[k] = fsDecode(fields[k]);
    return out;
  }
  return undefined;
}

/** fields（map）＋ドット区切り path で値(FsValue)を取得 */
function fsPick(
  fields: Record<string, FsValue> | undefined,
  path: string
): FsValue | undefined {
  if (!fields) return undefined;
  const parts = path.split(".");
  let cur: FsValue | undefined = { mapValue: { fields } };
  for (const p of parts) {
    if (!cur || !("mapValue" in cur) || !cur.mapValue.fields) return undefined;
    cur = cur.mapValue.fields[p];
  }
  return cur;
}

/** 高レベル getter（path で直接 JS 値を取得） */
export function fsGetAny(
  fields: Record<string, FsValue> | undefined,
  path: string
): unknown {
  const v = fsPick(fields, path);
  return fsDecode(v);
}

export function fsGetString(
  f: Record<string, FsValue> | undefined,
  path: string
) {
  const v = fsGetAny(f, path);
  return typeof v === "string" ? v : undefined;
}
export function fsGetNumber(
  f: Record<string, FsValue> | undefined,
  path: string
) {
  const v = fsGetAny(f, path);
  return typeof v === "number" ? v : undefined;
}
export function fsGetBoolean(
  f: Record<string, FsValue> | undefined,
  path: string
) {
  const v = fsGetAny(f, path);
  return typeof v === "boolean" ? v : undefined;
}
export function fsGetStringArray(
  f: Record<string, FsValue> | undefined,
  path: string
) {
  const v = fsGetAny(f, path);
  return Array.isArray(v)
    ? (v.filter((x) => typeof x === "string") as string[])
    : undefined;
}
export function fsGetObject<T = any>(
  f: Record<string, FsValue> | undefined,
  path: string
) {
  const v = fsGetAny(f, path);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : undefined;
}

/** 互換エイリアス（既存 import を維持） */
export const vStr = fsGetString;
export const vNum = fsGetNumber;

export function docIdFromName(name: string): string {
  const i = name.lastIndexOf("/");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** runQuery（REST） */
export async function fsRunQuery(params: {
  projectId?: string;
  apiKey?: string;
  collection: string;
  where?: Array<{
    field: string;
    op?:
      | "EQUAL"
      | "GREATER_THAN"
      | "LESS_THAN"
      | "GREATER_THAN_OR_EQUAL"
      | "LESS_THAN_OR_EQUAL";
    value: string | number | boolean | null;
  }>;
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" }[];
  limit?: number;
}) {
  const { collection, where = [], orderBy = [], limit } = params;
  const base = getProject();
  const projectId = params.projectId ?? base.projectId;
  const apiKey = params.apiKey ?? base.apiKey;

  const parent = `projects/${projectId}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${parent}:runQuery?key=${encodeURIComponent(
    apiKey
  )}`;

  const filters = where.map((w) => ({
    fieldFilter: {
      field: { fieldPath: w.field },
      op: w.op ?? "EQUAL",
      value: toFsValue(w.value),
    },
  }));

  const body: any = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      ...(filters.length
        ? { where: { compositeFilter: { op: "AND", filters } } }
        : {}),
      ...(orderBy.length
        ? {
            orderBy: orderBy.map((o) => ({
              field: { fieldPath: o.field },
              direction: o.direction ?? "ASCENDING",
            })),
          }
        : {}),
      ...(typeof limit === "number" ? { limit } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = "";
    try {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        detail = j?.error?.message ? ` — ${j.error.message}` : ` — ${txt}`;
      } catch {
        detail = txt ? ` — ${txt}` : "";
      }
    } catch {}
    throw new Error(`runQuery failed: ${res.status}${detail}`);
  }

  const rows = (await res.json()) as any[];
  return rows
    .map((r) => r.document as any)
    .filter(Boolean)
    .map((doc) => ({
      name: doc.name as string,
      fields: doc.fields as Record<string, FsValue>,
    }));
}

/** 単一ドキュメント取得（REST） */
export async function fsGet(params: {
  projectId?: string;
  apiKey?: string;
  path: string;
}) {
  const base = getProject();
  const projectId = params.projectId ?? base.projectId;
  const apiKey = params.apiKey ?? base.apiKey;

  const parent = `projects/${projectId}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${parent}/${encodeURI(
    params.path
  )}?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    let detail = "";
    try {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        detail = j?.error?.message ? ` — ${j.error.message}` : ` — ${txt}`;
      } catch {
        detail = txt ? ` — ${txt}` : "";
      }
    } catch {}
    throw new Error(`fsGet failed: ${res.status}${detail}`);
  }

  const doc = (await res.json()) as any;
  return {
    name: doc.name as string,
    fields: doc.fields as Record<string, FsValue>,
  };
}
