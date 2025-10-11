export type PainRuleLite = { id: string; label: string; tags: string[] };

// Firestore の sites/<siteId> の fields から painRules を抽出
export function decodePainRules(
  fields: Record<string, unknown> | undefined
): PainRuleLite[] {
  const raw = (fields as { [k: string]: unknown } | undefined)?.painRules as
    | {
        arrayValue?: {
          values?: Array<{ mapValue?: { fields?: Record<string, unknown> } }>;
        };
      }
    | undefined;
  const values = raw?.arrayValue?.values ?? [];
  const rules: PainRuleLite[] = [];

  for (const v of values) {
    const mv = v.mapValue?.fields;
    if (!mv) continue;

    const id =
      (mv.id as { stringValue?: string } | undefined)?.stringValue ?? "";
    const label =
      (mv.label as { stringValue?: string } | undefined)?.stringValue ?? "";

    const match = (
      mv.match as
        | { mapValue?: { fields?: Record<string, unknown> } }
        | undefined
    )?.mapValue?.fields;
    const anyTagsValues =
      (
        match?.anyTags as
          | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
          | undefined
      )?.arrayValue?.values ?? [];

    const tags: string[] = [];
    for (const t of anyTagsValues) {
      const sv = t.stringValue;
      if (sv) tags.push(sv);
    }

    if (id && label) rules.push({ id, label, tags });
  }
  return rules;
}
