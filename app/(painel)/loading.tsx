/**
 * Skeleton instantâneo para TODA navegação do painel.
 *
 * Antes não existia nenhum loading.tsx: cada clique ficava em tela parada por
 * 0,7–2s até o servidor responder. Com este arquivo o App Router pinta o
 * esqueleto imediatamente (<100ms) e o conteúdo real faz stream por cima.
 */
export default function CarregandoPainel() {
  return (
    <main className="mx-auto max-w-[1180px] animate-pulse px-5 py-8 sm:px-8 lg:py-11">
      <div className="h-9 w-56 rounded-lg bg-surface" />
      <div className="mt-2 h-4 w-80 rounded bg-surface/70" />
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-canvas px-5 py-4">
            <div className="h-3 w-24 rounded bg-surface" />
            <div className="mt-2.5 h-7 w-20 rounded bg-surface" />
          </div>
        ))}
      </div>
      <div className="mt-10 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-card border border-line bg-canvas" />
        ))}
      </div>
    </main>
  )
}
