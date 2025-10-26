// apps/web/components/products/ComparisonTable.tsx
import Image from "next/image";
import Link from "next/link";
import {
  fsRunQuery,
  fsGetString as vStr,
  fsGetNumber as vNum,
  fsGetBoolean as vBool,
  docIdFromName,
} from "@/lib/firestore-rest";

type OfferSource = "amazon" | "rakuten";
type SortKey =
  | "price_asc"
  | "price_desc"
  | "capacity_desc"
  | "weight_asc"
  | "output_desc"
  | "review_desc"
  | "newest";

type ProductRow = {
  asin: string;
  title: string;
  brand?: string;
  imageUrl?: string;
  bestPrice?: {
    price: number;
    url: string;
    source: OfferSource;
    updatedAt: number;
  };
  capacity?: number;
  weight?: number;
  outputPower?: number;
  reviewAverage?: number;
  reviewCount?: number;
  createdAt?: number;
  inStock?: boolean;
};

export type ComparisonTableProps = {
  siteId: string;
  categoryId?: string;
  /** 例: "price_asc" | "capacity_desc" | "weight_asc" など */
  sort?: SortKey;
  /** デフォルト: 5 */
  limit?: number;
  /** 該当ASINを先頭に優先表示（任意） */
  pinAsinFirst?: string;
};

/** Firestore REST からカテゴリ内商品を取得して整形 */
async function fetchProductsForTable(
  siteId: string,
  categoryId?: string
): Promise<ProductRow[]> {
  const where = [{ field: "siteId", value: siteId }] as {
    field: string;
    value: any;
  }[];
  if (categoryId) where.push({ field: "categoryId", value: categoryId });

  const docs = await fsRunQuery({
    collection: "products",
    where,
    // 最新順でざっと多めに取る（表用に十分な候補数）
    orderBy: [{ field: "createdAt", direction: "DESCENDING" }],
    limit: 150,
  }).catch(() => [] as any[]);

  const rows: ProductRow[] = docs.map((d: any) => {
    const f = d.fields;
    const bpPrice = vNum(f, "bestPrice.price");
    const bpUrl = vStr(f, "bestPrice.url");
    const bpSource = vStr(f, "bestPrice.source") as OfferSource | undefined;
    const bpUpdatedAt = vNum(f, "bestPrice.updatedAt");
    const bestPrice =
      typeof bpPrice === "number" &&
      bpUrl &&
      bpSource &&
      typeof bpUpdatedAt === "number"
        ? {
            price: bpPrice,
            url: bpUrl,
            source: bpSource,
            updatedAt: bpUpdatedAt,
          }
        : undefined;

    return {
      asin: docIdFromName(d.name),
      title: vStr(f, "title") ?? "",
      brand: vStr(f, "brand") ?? undefined,
      imageUrl: vStr(f, "imageUrl") ?? undefined,
      bestPrice,
      capacity: vNum(f, "capacity") ?? undefined,
      weight: vNum(f, "weight") ?? undefined,
      outputPower: vNum(f, "outputPower") ?? undefined,
      reviewAverage: vNum(f, "reviewAverage") ?? undefined,
      reviewCount: vNum(f, "reviewCount") ?? undefined,
      createdAt: vNum(f, "createdAt") ?? undefined,
      inStock: vBool(f, "inStock"),
    };
  });

  return rows;
}

function sortRows(rows: ProductRow[], sort: SortKey): ProductRow[] {
  const byNum = (
    v: any,
    fallbackLow: number,
    fallbackHigh: number,
    dir: 1 | -1
  ) => {
    const n =
      typeof v === "number" ? v : dir === 1 ? fallbackHigh : fallbackLow;
    return n;
  };
  const score = (r: ProductRow) =>
    (typeof r.reviewAverage === "number" ? r.reviewAverage : 0) *
    Math.log1p(typeof r.reviewCount === "number" ? r.reviewCount : 0);

  const arr = [...rows];
  switch (sort) {
    case "price_asc":
      arr.sort(
        (a, b) =>
          byNum(
            a.bestPrice?.price,
            Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            1
          ) -
          byNum(
            b.bestPrice?.price,
            Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            1
          )
      );
      break;
    case "price_desc":
      arr.sort(
        (a, b) =>
          byNum(
            b.bestPrice?.price,
            Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            -1
          ) -
          byNum(
            a.bestPrice?.price,
            Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            -1
          )
      );
      break;
    case "capacity_desc":
      arr.sort(
        (a, b) => byNum(b.capacity, -1, -1, -1) - byNum(a.capacity, -1, -1, -1)
      );
      break;
    case "weight_asc":
      arr.sort(
        (a, b) =>
          byNum(
            a.weight,
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            1
          ) -
          byNum(b.weight, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 1)
      );
      break;
    case "output_desc":
      arr.sort(
        (a, b) =>
          byNum(b.outputPower, -1, -1, -1) - byNum(a.outputPower, -1, -1, -1)
      );
      break;
    case "review_desc":
      arr.sort((a, b) => score(b) - score(a));
      break;
    case "newest":
    default:
      arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      break;
  }
  return arr;
}

function jpy(n?: number) {
  return typeof n === "number"
    ? new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
      }).format(n)
    : "—";
}

export default async function ComparisonTable(props: ComparisonTableProps) {
  const {
    siteId,
    categoryId,
    sort = "price_asc",
    limit = 5,
    pinAsinFirst,
  } = props;

  let rows = await fetchProductsForTable(siteId, categoryId);

  // 価格のないものは表では除外（見やすさ優先）
  rows = rows.filter((r) => typeof r.bestPrice?.price === "number");

  // ピン止め（存在すれば先頭に）
  if (pinAsinFirst) {
    const pinned = rows.find((r) => r.asin === pinAsinFirst);
    if (pinned) {
      rows = [pinned, ...rows.filter((r) => r.asin !== pinAsinFirst)];
    }
  }

  rows = sortRows(rows, sort).slice(0, limit);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        比較対象が見つかりませんでした。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="min-w-[720px] w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
            <th>商品</th>
            <th className="w-24 text-right">容量</th>
            <th className="w-24 text-right">出力</th>
            <th className="w-24 text-right">重さ</th>
            <th className="w-28 text-right">最安</th>
            <th className="w-24">リンク</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.asin}
              className="border-t [&>td]:px-3 [&>td]:py-2 align-middle"
            >
              <td>
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-16 overflow-hidden rounded bg-gray-50">
                    {r.imageUrl ? (
                      <Image
                        src={r.imageUrl}
                        alt={r.title}
                        fill
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div>
                    <Link
                      href={`/products/${r.asin}`}
                      className="font-medium hover:underline line-clamp-2"
                    >
                      {r.title}
                    </Link>
                    <div className="text-xs text-gray-500">{r.brand ?? ""}</div>
                  </div>
                </div>
              </td>
              <td className="text-right">
                {typeof r.capacity === "number" ? `${r.capacity} mAh` : "—"}
              </td>
              <td className="text-right">
                {typeof r.outputPower === "number" ? `${r.outputPower} W` : "—"}
              </td>
              <td className="text-right">
                {typeof r.weight === "number" ? `${r.weight} g` : "—"}
              </td>
              <td className="text-right font-semibold">
                {jpy(r.bestPrice?.price)}
              </td>
              <td>
                {r.bestPrice?.url ? (
                  <a
                    href={`/out/${encodeURIComponent(
                      r.asin
                    )}?to=${encodeURIComponent(r.bestPrice.url)}&src=comp`}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="rounded border px-2.5 py-1 text-xs hover:shadow-sm inline-block"
                  >
                    購入
                  </a>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
