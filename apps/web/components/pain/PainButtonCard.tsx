// apps/web/components/pain/PainButtonCard.tsx
import Link from "next/link";
import type { PainRuleLite } from "@/lib/pain-rules";

type BrandLike = {
  primary?: string;
  accent?: string;
  theme?: "light" | "dark";
};

export type PainButtonCardProps = {
  rule: PainRuleLite & { personas?: string[] };
  brand?: BrandLike;
  hrefBase?: string; // 既定: /pain/:id
  className?: string;
};

function emojiFor(rule: { id?: string; label?: string; tags?: string[] }) {
  const id = (rule.id ?? "").toLowerCase();
  const label = (rule.label ?? "").toLowerCase();
  const text = `${id} ${label} ${(rule.tags ?? []).join(" ")}`.toLowerCase();

  // ---- ChairScope（チェア）
  if (text.match(/back_pain|腰|腰痛|ランバー/)) return "😣";
  if (text.match(/sweat|蒸れ|mesh|メッシュ/)) return "🌬️";
  if (text.match(/best_value|コスパ/)) return "💰";

  // ---- ChargeScope（モバイルバッテリー）
  if (text.match(/battery_anxiety|電池切れ/)) return "🔋";
  if (text.match(/carry_weight|軽量|薄型/)) return "🪶";
  if (text.match(/multi_device|多台同時|複数/)) return "🔌";
  if (text.match(/flight_ok|機内/)) return "✈️";
  if (text.match(/magsafe/)) return "🧲";

  // ---- PowerScope（ポータブル電源）
  if (text.match(/blackout|停電|backup/)) return "🏠";
  if (text.match(/camp|静音|キャンプ/)) return "🏕️";
  if (text.match(/workation|laptop|pc|カメラ/)) return "💻";
  if (text.match(/safety_battery|lfp|リン酸鉄|安全/)) return "🛡️";

  return "✨";
}

export default function PainButtonCard({
  rule,
  brand,
  hrefBase = "/pain",
  className,
}: PainButtonCardProps) {
  const href = `${hrefBase}/${encodeURIComponent(rule.id)}`;

  // ブランド色（なければデフォルトの青→シアン）
  const primary = brand?.primary ?? "#3b82f6";
  const accent = brand?.accent ?? "#06b6d4";
  const dark = brand?.theme === "dark";

  const captionColor = dark ? "text-emerald-300/80" : "text-emerald-700/80";
  const persona =
    rule.personas && rule.personas.length > 0
      ? `想定: ${rule.personas.slice(0, 2).join("／")}`
      : undefined;

  return (
    <Link
      href={href}
      className={[
        "group block rounded-2xl border border-gray-100 p-5 shadow-sm transition-all",
        "hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        className ?? "",
      ].join(" ")}
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.03) 100%)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl leading-none">{emojiFor(rule)}</div>
        <div className="flex-1">
          <h3 className="text-base md:text-lg font-semibold tracking-tight">
            {rule.label}
          </h3>
          {rule.tags && rule.tags.length > 0 && (
            <p className="mt-1 text-sm text-gray-600">
              #{rule.tags.join(" #")}
            </p>
          )}
        </div>
      </div>

      <hr className="my-4 border-gray-200" />

      <div
        className={[
          "inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold text-white",
          "transition-transform group-hover:translate-x-0.5",
        ].join(" ")}
        style={{
          background: `linear-gradient(90deg, ${primary} 0%, ${accent} 100%)`,
        }}
      >
        今すぐチェック <span className="ml-1">→</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className={`text-xs ${captionColor}`}>
          押すと「{rule.label}」の解決ページへ
        </p>
        {persona && (
          <span className="text-[10px] rounded bg-gray-100 px-2 py-0.5">
            {persona}
          </span>
        )}
      </div>
    </Link>
  );
}
