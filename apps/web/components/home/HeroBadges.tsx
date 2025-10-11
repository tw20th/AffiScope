export default function HeroBadges({
  dataSourceLabel,
  note,
}: {
  dataSourceLabel: string;
  note: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 text-xs opacity-80">
      <span className="rounded-full border px-3 py-1">
        データ元: {dataSourceLabel}
      </span>
      <span className="rounded-full border px-3 py-1">毎日自動更新</span>
      <span className="rounded-full border px-3 py-1">{note}</span>
    </div>
  );
}
