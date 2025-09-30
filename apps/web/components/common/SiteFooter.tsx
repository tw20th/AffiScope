import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-gray-600">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="mb-2 font-semibold">運営者情報</div>
            <p className="opacity-80">
              実機レビュー・公式データをもとに中立的に比較・解説します。
            </p>
          </div>
          <div>
            <div className="mb-2 font-semibold">サイトポリシー</div>
            <ul className="space-y-1">
              <li>
                <Link href="/policy/ads" className="underline">
                  広告掲載について
                </Link>
              </li>
              <li>
                <Link href="/policy/privacy" className="underline">
                  プライバシーポリシー
                </Link>
              </li>
              <li>
                <Link href="/policy/disclaimer" className="underline">
                  免責事項
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="mb-2 font-semibold">お問い合わせ</div>
            <p className="opacity-80">
              ご意見・修正依頼は{" "}
              <Link href="/contact" className="underline">
                こちら
              </Link>{" "}
              から。
            </p>
          </div>
        </div>
        <div className="mt-6 text-xs opacity-60">
          © {new Date().getFullYear()} ChairScope
        </div>
      </div>
    </footer>
  );
}
