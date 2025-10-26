// apps/web/components/products/PriceSparkline.tsx
"use client";

type Point = { ts: number; price: number };

export default function PriceSparkline({
  data,
  height = 36,
}: {
  data?: Point[];
  height?: number;
}) {
  if (!data || data.length < 2) return null;

  // 最新30点程度に圧縮（多すぎると重い）
  const last = data.slice(-30);
  const prices = last.map((p) => p.price).filter((n) => typeof n === "number");
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const w = Math.max(60, last.length * 8);

  const points = last.map((p, i) => {
    const x = (i / (last.length - 1)) * (w - 6) + 3; // 3px padding
    const y = (1 - norm(p.price)) * (height - 6) + 3;
    return `${x},${y}`;
  });

  // 終値と始値で上がった/下がった判定（色は指定せずCSS任せ）
  const trendUp = last[last.length - 1].price <= last[0].price ? false : true;

  return (
    <div className="relative" style={{ width: w, height }}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width={w}
        height={height}
        className="overflow-visible"
      >
        {/* 背景の薄い帯 */}
        <rect x="0" y="0" width={w} height={height} className="fill-gray-50" />
        {/* 折れ線 */}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={points.join(" ")}
          className={trendUp ? "text-emerald-600" : "text-red-500"}
        />
      </svg>
    </div>
  );
}
