export default function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const percent = maxScore > 0 ? Math.min(100, Math.max(0, (score / maxScore) * 100)) : 0;
  return (
    <div className="flex items-center gap-2" title={`Relevance score: ${score.toFixed(2)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
