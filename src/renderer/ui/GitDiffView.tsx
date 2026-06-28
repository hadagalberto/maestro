export function GitDiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="p-3 text-xs text-zinc-600">selecione um arquivo</div>
  return (
    <pre className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-2 font-mono text-xs leading-tight">
      {diff.split('\n').map((line, i) => {
        const c = line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400'
          : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
          : line.startsWith('@@') ? 'text-cyan-400'
          : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---') ? 'text-zinc-500'
          : 'text-zinc-300'
        return <div key={i} className={c}>{line || ' '}</div>
      })}
    </pre>
  )
}
