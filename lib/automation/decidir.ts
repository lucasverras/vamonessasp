import 'server-only'
import { db } from '../db'
import { NUNCA_AUTOMATICO, type Intencao } from '../ai/prompt'

/**
 * A decisão pós-análise: o que fazer com o que a IA sugeriu.
 *
 * comentário → análise → ESTA DECISÃO → fila (com atraso) | revisão | registro
 *
 * O caminho automático exige TODAS as condições:
 *   1. automação ligada (reply_mode ≠ OFF) e marco de início definido;
 *   2. comentário criado DEPOIS do marco — histórico nunca entra sozinho;
 *   3. decisão da IA foi enviar (não HOLD, não SKIP);
 *   4. intenção fora da lista never-auto (trava de servidor, não de modelo);
 *   5. categoria liberada na configuração (elogios / perguntas / marcações);
 *   6. confiança ≥ mínimo configurado.
 *
 * Falhou qualquer uma → PENDING_APPROVAL (fila "precisa de você") ou SHADOW
 * (registro). Na dúvida, humano. O atraso de 3–7 min é sorteado por ação:
 * responder em 4 segundos entrega que é máquina.
 */

export interface ConfigAutomacao {
  reply_mode: 'OFF' | 'DRY_RUN' | 'LIVE'
  kill_switch: boolean
  delay_min_seconds: number
  delay_max_seconds: number
  reply_praise: boolean
  reply_known_questions: boolean
  reply_mentions: boolean
  automation_started_at: string | null
  auto_approve_intents: string[]
  never_auto_intents: string[]
  min_confidence_for_auto: number
}

export async function lerConfigAutomacao(): Promise<ConfigAutomacao | null> {
  const { data } = await db()
    .from('automation_settings')
    .select(
      'reply_mode,kill_switch,delay_min_seconds,delay_max_seconds,reply_praise,reply_known_questions,reply_mentions,automation_started_at,auto_approve_intents,never_auto_intents,min_confidence_for_auto',
    )
    .eq('id', true)
    .single()
  return (data as ConfigAutomacao | null) ?? null
}

const CATEGORIAS_ELOGIO: string[] = ['elogio', 'interesse_em_visitar', 'comentario_generico']
const CATEGORIAS_PERGUNTA: string[] = ['localizacao', 'preco', 'horario', 'duvida']

function categoriaLiberada(cfg: ConfigAutomacao, intent: string): boolean {
  if (CATEGORIAS_ELOGIO.includes(intent)) return cfg.reply_praise
  if (CATEGORIAS_PERGUNTA.includes(intent)) return cfg.reply_known_questions
  if (intent === 'marcacao_de_amigo') return cfg.reply_mentions
  return false
}

export type StatusInicial = 'QUEUED' | 'PENDING_APPROVAL' | 'SHADOW'

export interface Decisao {
  status: StatusInicial
  /** Instante agendado, apenas quando QUEUED. */
  agendadoPara: string | null
  motivo: string
}

export function decidirDestino(args: {
  cfg: ConfigAutomacao
  intent: string
  confidence: number
  decision: string
  requiresHuman: boolean
  commentedAt: string
}): Decisao {
  const { cfg } = args

  if (cfg.reply_mode === 'OFF' || !cfg.automation_started_at) {
    return { status: 'SHADOW', agendadoPara: null, motivo: 'automacao desligada' }
  }
  if (new Date(args.commentedAt) < new Date(cfg.automation_started_at)) {
    // Histórico é operação manual. Fica visível na revisão, nunca auto.
    return { status: 'SHADOW', agendadoPara: null, motivo: 'anterior ao marco de inicio' }
  }
  if (args.requiresHuman || args.decision === 'HOLD_FOR_REVIEW') {
    return { status: 'PENDING_APPROVAL', agendadoPara: null, motivo: 'exige revisao humana' }
  }
  if (
    NUNCA_AUTOMATICO.includes(args.intent as Intencao) ||
    (cfg.never_auto_intents ?? []).includes(args.intent)
  ) {
    return { status: 'PENDING_APPROVAL', agendadoPara: null, motivo: 'intencao nunca-automatica' }
  }

  const liberada =
    categoriaLiberada(cfg, args.intent) || (cfg.auto_approve_intents ?? []).includes(args.intent)
  if (!liberada) {
    return { status: 'PENDING_APPROVAL', agendadoPara: null, motivo: 'categoria nao liberada' }
  }
  if (args.confidence < Number(cfg.min_confidence_for_auto ?? 0.85)) {
    return { status: 'PENDING_APPROVAL', agendadoPara: null, motivo: 'confianca abaixo do minimo' }
  }

  // Tudo liberado: agenda com atraso humano sorteado na janela configurada.
  const min = Math.max(0, cfg.delay_min_seconds)
  const max = Math.max(min, cfg.delay_max_seconds)
  const atrasoS = min + Math.floor(Math.random() * (max - min + 1))
  return {
    status: 'QUEUED',
    agendadoPara: new Date(Date.now() + atrasoS * 1000).toISOString(),
    motivo: `auto, atraso ${Math.round(atrasoS / 60)}min`,
  }
}
