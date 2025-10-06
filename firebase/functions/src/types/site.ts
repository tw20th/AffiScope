// firebase/functions/src/types/site.ts
export type PainRule = {
  id: string;
  label: string;
  match: { anyTags?: string[] };
  personas?: string[];
};

export type SiteConfig = {
  siteId: string;
  displayName: string;
  domain: string;
  defaultPersona?: string;
  painRules?: PainRule[];
};
