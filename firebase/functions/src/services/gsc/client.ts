import { getApps, initializeApp } from "firebase-admin/app";
if (getApps().length === 0) initializeApp();

import { google } from "googleapis";

/** サービスアカウントJSON文字列 → JWTクライアント */
export function makeGscJwt(saJson: string) {
  const creds = JSON.parse(saJson);
  const jwt = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return google.searchconsole({ version: "v1", auth: jwt });
}

/** サイト設定からGSCのプロパティURLを推定（site.jsonにあればそれを使う） */
export function resolvePropertyUrl(site: {
  domain?: string;
  gsc?: { propertyUrl?: string };
}) {
  if (site?.gsc?.propertyUrl) return site.gsc.propertyUrl;
  if (site?.domain) {
    const host = site.domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${host}/`;
  }
  throw new Error("Cannot resolve GSC propertyUrl from site config");
}
