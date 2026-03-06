import type { AnalysisScore, SpeechStats } from "@screencraft/shared";
import { cn } from "@/lib/cn";

interface Props {
  score: AnalysisScore;
  speechStats: SpeechStats;
  coveragePercent: number;
}

function ScoreRing({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = (value / max) * 100;
  const color =
    pct >= 80 ? "text-green-500" : pct >= 60 ? "text-amber-500" : "text-red-500";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn("text-2xl font-bold tabular-nums", color)}>
        {value}
        <span className="text-xs text-slate-400 font-normal">/{max}</span>
      </div>
      <div className="text-xs text-slate-500 text-center">{label}</div>
    </div>
  );
}

export function ScoreCard({ score, speechStats, coveragePercent }: Props) {
  const totalColor =
    score.total >= 80
      ? "text-green-600"
      : score.total >= 60
        ? "text-amber-600"
        : "text-red-600";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-8">
        {/* Total score */}
        <div className="flex flex-col items-center">
          <div className={cn("text-6xl font-bold tabular-nums", totalColor)}>
            {score.total}
          </div>
          <div className="text-sm text-slate-500 mt-1">/ 100</div>
        </div>

        {/* Sub-scores */}
        <div className="flex items-center gap-6 flex-1 flex-wrap">
          <ScoreRing value={score.speechClarity} max={30} label="Speech Clarity" />
          <ScoreRing value={score.contentCoverage} max={25} label="Content Coverage" />
          <ScoreRing value={score.presentationFlow} max={20} label="Pres. Flow" />
          <ScoreRing value={score.visualQuality} max={15} label="Visual Quality" />
          <ScoreRing value={score.openingClosing} max={10} label="Opening/Closing" />
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-lg font-semibold text-slate-900 tabular-nums">
            {speechStats.avgWpm}
          </div>
          <div className="text-xs text-slate-400">Avg WPM</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-900 tabular-nums">
            {coveragePercent}%
          </div>
          <div className="text-xs text-slate-400">Script coverage</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-900 tabular-nums">
            {speechStats.pauseCount}
          </div>
          <div className="text-xs text-slate-400">Long pauses</div>
        </div>
      </div>
    </div>
  );
}
