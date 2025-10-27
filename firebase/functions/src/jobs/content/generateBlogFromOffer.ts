import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { a8BlogSlug } from "../../lib/slug/a8.js";
import { findUnsplashHero } from "../../services/unsplash/client.js";

type Creative = {
  materialId: string;
  type: "text" | "banner";
  label?: string;
  size?: string;
  href: string;
  imgSrc?: string;
};

export async function generateBlogFromOffer(opts: {
  offerId: string;
  siteId: string; // 例: "kariraku"
  dryRun?: boolean;
}) {
  const { offerId, siteId, dryRun } = opts;
  const db = getFirestore();

  // ---- 1) fetch offer & program
  const offerSnap = await db.collection("offers").doc(offerId).get();
  if (!offerSnap.exists) throw new Error(`offer not found: ${offerId}`);
  const offer = offerSnap.data() as any;

  const programSnap = await db
    .collection("programs")
    .doc(offer.programId)
    .get();
  const program = programSnap.exists ? programSnap.data() : {};

  // ---- 2) pick creatives (CTA)
  const creatives: Creative[] = Array.isArray(offer.creatives)
    ? offer.creatives
    : [];
  const ctaBanner =
    creatives.find((c) => c.type === "banner" && c.size === "300x250") ||
    creatives.find((c) => c.type === "banner") ||
    undefined;
  const ctaText = creatives.find((c) => c.type === "text") || undefined;

  // ---- 3) assemble content (markdown)
  const title = `${offer.title}｜${program?.advertiser ?? ""}`.replace(
    /｜$/,
    ""
  );
  const adLabel = "※本ページは広告を含みます";
  const lead =
    offer.description ||
    `${offer.title}の特徴・料金・対応エリアをわかりやすく解説します。`;

  const benefits: string[] = offer.badges?.length
    ? offer.badges
    : [
        "最短30日から利用OK",
        "配送料・設置・回収まで込み（セット）",
        "プロの徹底清掃・消毒／不具合は無償交換",
      ];

  const areas: string[] = offer.extras?.areas ?? [];
  const fees = offer.extras?.fees ?? {};
  const payment = offer.extras?.payment ?? [];
  const deliveryDays: string[] = offer.extras?.deliveryDays ?? [];

  const ctaMd = ctaBanner
    ? `[![広告バナー](${ctaBanner.imgSrc})](${ctaBanner.href} "nofollow")`
    : ctaText
    ? `[${ctaText.label ?? "公式サイトで詳しく見る"}](${
        ctaText.href
      } "nofollow")`
    : "";

  const priceLead = offer.price
    ? `月${offer.price.toLocaleString()}円〜`
    : offer.planType === "subscription"
    ? "月額プランあり"
    : "";

  const md = [
    `# ${title}`,
    ``,
    `${adLabel}`,
    ``,
    `> ${lead}`,
    ``,
    ctaMd,
    ``,
    `## こんな人に向いています`,
    ...benefits.map((b) => `- ${b}`),
    ``,
    `## 料金とプラン`,
    priceLead
      ? `- リード料金：**${priceLead}**`
      : "- 料金：公式をご確認ください",
    offer.planType
      ? `- プラン種別：${
          offer.planType === "subscription"
            ? "サブスク（月額）"
            : offer.planType === "product"
            ? "一括払い"
            : "お試し"
        }`
      : "",
    fees.setRental ? `- セット利用：${fees.setRental}` : "",
    fees.singleItem ? `- 単品レンタル：${fees.singleItem}` : "",
    fees.subscriptionInit ? `- サブスク初期費：${fees.subscriptionInit}` : "",
    payment?.length ? `- 支払い方法：${payment.join(" / ")}` : "",
    ``,
    `## 対応エリア`,
    areas.length
      ? areas.map((a) => `- ${a}`).join("\n")
      : "対応エリアの詳細は公式ページをご確認ください。",
    ``,
    deliveryDays.length ? `- 配送日：${deliveryDays.join("・")}` : "",
    offer.extras?.timeSlot ? `- 時間指定：${offer.extras.timeSlot}` : "",
    ``,
    `## 申し込みの流れ`,
    `1. Webから申込（希望機種・期間を選択）`,
    `2. お届け・設置・契約手続き`,
    `3. 利用（不具合は無償交換）`,
    `4. 回収（延長・買取の相談も可）`,
    ``,
    ctaMd,
    ``,
    `## よくある質問（かんたん版）`,
    `- **最短どのくらい？** 30日からOK（案件により異なる）`,
    `- **設置や回収は？** セット利用は設置・回収まで込み（対応エリア内）`,
    `- **サブスクの支払い方法は？** 多くの案件でクレジットカードのみ`,
    ``,
    `---`,
    `出典：${program?.advertiser ?? ""} / ${offer.landingUrl}`,
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  // ---- 4) slug（docId=slug）＋画像（Unsplash補完）
  const now = Date.now();
  const slug = a8BlogSlug(siteId, offerId, offer.title, now);

  // 既に同slugがあれば早期リターン（同一offerの重複回避）
  const existing = await getFirestore().collection("blogs").doc(slug).get();
  if (existing.exists) {
    logger.info(`generateBlogFromOffer: already exists blogs/${slug}`);
    return { slug, existed: true };
  }

  // 画像：offer.imageUrl/heroImage/creative を優先、なければ Unsplash 検索
  let imageUrl: string | null =
    offer.imageUrl ??
    offer.heroImage ??
    ctaBanner?.imgSrc ??
    offer.images?.[0] ??
    null;
  let imageCredit: string | null = null;
  let imageCreditLink: string | null = null;

  if (!imageUrl) {
    const query = [siteId, program?.advertiser, offer.title]
      .filter(Boolean)
      .join(" ");
    const hero = await findUnsplashHero(query || "家電 レンタル");
    if (hero?.url) {
      imageUrl = hero.url;
      imageCredit = hero.credit || null;
      imageCreditLink = hero.creditLink || null;
    }
  }

  const blogDoc = {
    slug, // ★ 追加：フィールドとしても保存
    siteId,
    title,
    summary: (lead || "").slice(0, 120),
    content: md,

    // 画像は imageUrl に統一（表示側は heroImage もフォールバックでOK）
    imageUrl,
    imageCredit: imageCredit ?? null,
    imageCreditLink: imageCreditLink ?? null,

    offerId,
    advertiser: program?.advertiser ?? null,
    source: "a8-offer",
    status: "published",
    visibility: "public",

    tags: Array.isArray(offer.tags) ? offer.tags : [],
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    views: 0,
  };

  if (dryRun) {
    logger.info(`[DRYRUN] blog slug=${slug}`, { blogDoc });
    return { slug, preview: blogDoc };
  }

  await db.collection("blogs").doc(slug).set(blogDoc, { merge: true });
  logger.info(
    `generateBlogFromOffer: created blogs/${slug} from offer ${offerId}`
  );
  return { slug };
}
