import { ShieldCheck, RefreshCw, Info } from "lucide-react";

type Props = {
  dataSource?: string; // 例: "Amazon / 楽天"
  note?: string; // 例: "本ページは広告を含みます"
  updatedText?: string; // 例: "毎日自動更新"
};

export default function TrustBar({
  dataSource = "Amazon / 楽天",
  note = "本ページは広告を含みます",
  updatedText = "毎日自動更新",
}: Props) {
  return (
    <div className="mb-6 rounded-xl border bg-white/60 backdrop-blur px-4 py-3 text-sm">
      <ul className="flex flex-wrap gap-4">
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          <span>データ元: {dataSource}</span>
        </li>
        <li className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          <span>{updatedText}</span>
        </li>
        <li className="flex items-center gap-2 opacity-80">
          <Info className="h-4 w-4" />
          <span>{note}</span>
        </li>
      </ul>
    </div>
  );
}
