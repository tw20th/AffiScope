export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-2xl font-bold">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-gray-600">
        URLをご確認のうえ、トップへお戻りください。
      </p>
      <a
        href="/"
        className="mt-4 inline-block rounded-lg border px-4 py-2 hover:shadow-sm"
      >
        トップへ戻る
      </a>
    </main>
  );
}
