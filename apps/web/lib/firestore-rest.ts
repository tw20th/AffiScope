// apps/web/lib/firestore-rest.ts
type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null };

function toFsValue(v: string | number | boolean | null): FsValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) }; // Firestore integer は文字列
  if (typeof v === "number") return { doubleValue: v };
  return { booleanValue: v };
}

// --- 便利: プロジェクト設定を env から取得
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

/** runQuery（REST）: コレクションに対して where/order/limit で取得 */
export async function fsRunQuery(params: {
  projectId?: string;
  apiKey?: string;
  collection: string; // 例: "blogs"
  where?: Array<{
    field: string;
    op?: "EQUAL" | "GREATER_THAN" | "LESS_THAN";
    value: string | number | boolean | null;
  }>;
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" }[];
  limit?: number;
}) {
  const { collection, where = [], orderBy = [], limit } = params;
  const { projectId, apiKey } = {
    ...getProject(),
    projectId: params.projectId ?? getProject().projectId,
    apiKey: params.apiKey ?? getProject().apiKey,
  };

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
      // FirestoreはJSON/テキストいずれもあり得る。まずJSONを試す。
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
      fields: doc.fields as Record<string, any>,
    }));
}

/** 単一ドキュメント取得（REST）: `collection/docId` を GET */
export async function fsGet(params: {
  projectId?: string;
  apiKey?: string;
  path: string; // 例: "blogs/price-vs-value"
}) {
  const { projectId, apiKey } = {
    ...getProject(),
    projectId: params.projectId ?? getProject().projectId,
    apiKey: params.apiKey ?? getProject().apiKey,
  };
  const parent = `projects/${projectId}/databases/(default)/documents`;

  // スラッシュは残す（パスとして有効）ため encodeURI を使用
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
    fields: doc.fields as Record<string, any>,
  };
}

// --- Firestore REST 値 → JS 値（名前を vStr/vNum に合わせてエクスポート）
export function fsGetString(f: any, key: string) {
  return f?.[key]?.stringValue as string | undefined;
}
export function fsGetNumber(f: any, key: string) {
  const v = f?.[key];
  if (!v) return undefined;
  if (typeof v.integerValue === "string") return Number(v.integerValue);
  if (typeof v.doubleValue === "number") return v.doubleValue;
  return undefined;
}

// 互換エイリアス（既存コードの import をそのまま使えるように）
export const vStr = fsGetString;
export const vNum = fsGetNumber;

// name => docId 抽出（REST は "projects/.../documents/collection/doc" 形式）
export function docIdFromName(name: string): string {
  const i = name.lastIndexOf("/");
  return i >= 0 ? name.slice(i + 1) : name;
}
