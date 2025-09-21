export default function Page() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold">AffiScope 起動テスト</h1>
      <p className="mt-2 text-sm text-gray-600">Next14 + React18 + Tailwind v3 ✅</p>

      <div className="mt-6 flex gap-3">
        <span className="inline-flex items-center rounded-xl bg-blue-100 px-3 py-1 text-blue-700">
          badge
        </span>
        <button className="rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          ボタン
        </button>
      </div>
    </main>
  );
}
