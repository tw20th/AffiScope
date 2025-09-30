export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="h-6 w-60 rounded bg-gray-200 animate-pulse" />
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-44 rounded-2xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    </main>
  );
}
