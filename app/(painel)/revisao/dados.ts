import 'server-only'
import type { ItemPrecisaDeVoce } from '@/components/precisa-de-voce'

/**
 * Montagem da fila "Precisa de você" FORA do componente: Date.now() em render
 * viola a regra de pureza do React — aqui é camada de dados, calculado uma vez
 * por request.
 */

export interface LinhaFila {
  analysis_id: string
  comment_id: string
  media_id: string | null
  username: string | null
  comment_text: string | null
  commented_at: string
  eligibility_expires_at: string | null
  intent: string | null
  intent_confidence: number | null
  decision_reason: string | null
  decision_reason_code: string | null
  facts_available: string[] | null
  facts_missing: string[] | null
  suggested_public_reply: string | null
  caption: string | null
  thumbnail_url: string | null
  permalink: string | null
}

const NUNCA_DM = ['critica', 'situacao_delicada', 'oportunidade_comercial', 'spam']

export function montarFilaPrecisaDeVoce(linhas: LinhaFila[]): ItemPrecisaDeVoce[] {
  const agora = Date.now()
  const relogio = (iso: string) => {
    const min = Math.floor((agora - new Date(iso).getTime()) / 60_000)
    if (min < 60) return `há ${Math.max(min, 1)} min`
    const h = Math.floor(min / 60)
    return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`
  }

  return linhas.map((r) => {
    const diasDm = r.eligibility_expires_at
      ? Math.floor((new Date(r.eligibility_expires_at).getTime() - agora) / 86_400_000)
      : null
    return {
      analysisId: r.analysis_id,
      commentId: r.comment_id,
      mediaId: r.media_id,
      username: r.username,
      texto: r.comment_text,
      quando: relogio(r.commented_at),
      janelaDm:
        diasDm !== null && diasDm >= 0 ? `Private Reply elegível por mais ${diasDm}d` : null,
      intent: r.intent,
      confianca: r.intent_confidence !== null ? Number(r.intent_confidence) : null,
      motivo: r.decision_reason,
      motivoCodigo: r.decision_reason_code,
      fatosDisponiveis: r.facts_available ?? [],
      fatosFaltando: r.facts_missing ?? [],
      sugestao: r.suggested_public_reply,
      caption: r.caption,
      thumbnail: r.thumbnail_url,
      permalink: r.permalink,
      dmPadrao: !NUNCA_DM.includes(r.intent ?? ''),
    }
  })
}
