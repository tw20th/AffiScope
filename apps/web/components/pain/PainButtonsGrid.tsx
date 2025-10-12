// apps/web/components/pain/PainButtonsGrid.tsx
import type { PainRuleLite } from "@/lib/pain-rules";
import PainButtonCard from "./PainButtonCard";

export type PainButtonsGridProps = {
  rules: (PainRuleLite & { personas?: string[] })[];
  brand?: { primary?: string; accent?: string; theme?: "light" | "dark" };
  title?: string; // サイトごとの見出し（例: 悩み別おすすめ電源）
  subtitle?: string; // サイトの説明（例: 在宅ワーカー向け…）
  hrefBase?: string;
  className?: string;
};

export default function PainButtonsGrid({
  rules,
  brand,
  title = "悩みから選ぶ",
  subtitle,
  hrefBase = "/pain",
  className,
}: PainButtonsGridProps) {
  if (!rules || rules.length === 0) return null;

  return (
    <section aria-labelledby="pain-buttons-heading" className={className}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2
            id="pain-buttons-heading"
            className="text-lg md:text-xl font-bold"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        <p className="hidden md:block text-xs text-gray-500">
          状況に合う商品へ最短導線
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {rules.map((r) => (
          <PainButtonCard
            key={r.id}
            rule={r}
            brand={brand}
            hrefBase={hrefBase}
          />
        ))}
      </div>
    </section>
  );
}
