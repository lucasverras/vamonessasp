import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { db } from '../db'
import {
  INTENCOES,
  NUNCA_AUTOMATICO,
  PROMPT_NOME,
  PROMPT_VERSAO,
  SYSTEM_PROMPT,
  montarPromptUsuario,
  type Intencao,
} from './prompt'

/**
 * Classificação e geração — SHADOW MODE.
 *
 * Este módulo escreve em comment_analyses e cria ações com status SHADOW. Ele
 * NÃO envia nada e não tem como enviar: o worker é o único caminho de saída, e
 * ele recusa qualquer ação SHADOW.
 *
 * Modelo padrão: claude-opus-5. Configurável por linha em ai_prompts para
 * quando você quiser trocar o custo pela capacidade — a decisão é sua, e o
 * registro de qual modelo produziu cada análise fica em comment_analyses.model.
 */

const MODELO_PADRAO = 'claude-opus-5'

/**
 * Schema da saída. Structured outputs garantem que a resposta valide contra
 * isto — sem parsing frágil, sem retry por JSON malformado.
 */
const Analise = z.object({
  intencao: z.enum(INTENCOES),
  intencoes_secundarias: z.array(z.enum(INTENCOES)),
  confianca: z.number(),
  sentimento: z.enum(['positivo', 'neutro', 'negativo']),
  idioma: z.string(),
  risco: z.enum(['nenhum', 'baixo', 'medio', 'alto']),
  risco_motivos: z.array(z.string()),
  exige_humano: z.boolean(),
  resposta_publica: z.string().nullable(),
  mensagem_privada: z.string().nullable(),
  cta_estrategia: z.string().nullable(),
  decisao: z.enum([
    'enviar_ambas',
    'apenas_publica',
    'apenas_privada',
    'aguardar_revisao',
    'descartar',
  ]),
  decisao_motivo: z.string(),
})

export type Analise = z.infer<typeof Analise>

const DECISAO_DB: Record<Analise['decisao'], string> = {
  enviar_ambas: 'SEND_BOTH',
  apenas_publica: 'SEND_PUBLIC_ONLY',
  apenas_privada: 'SEND_PRIVATE_ONLY',
  aguardar_revisao: 'HOLD_FOR_REVIEW',
  descartar: 'SKIP',
}

const RISCO_DB: Record<Analise['risco'], string> = {
  nenhum: 'NONE',
  baixo: 'LOW',
  medio: 'MEDIUM',
  alto: 'HIGH',
}

let cliente: Anthropic | null = null
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY ausente. A análise por IA não roda sem ela; o resto do sistema funciona.',
    )
  }
  cliente ??= new Anthropic()
  return cliente
}

/** Garante que a versão atual do prompt está registrada e devolve seu id. */
export async function garantirPromptRegistrado(modelo = MODELO_PADRAO): Promise<string> {
  const { data: existente } = await db()
    .from('ai_prompts')
    .select('id')
    .eq('name', PROMPT_NOME)
    .eq('version', PROMPT_VERSAO)
    .maybeSingle()

  if (existente) return existente.id

  const { data, error } = await db()
    .from('ai_prompts')
    .insert({
      name: PROMPT_NOME,
      version: PROMPT_VERSAO,
      system_prompt: SYSTEM_PROMPT,
      user_template: 'ver lib/ai/prompt.ts → montarPromptUsuario',
      model: modelo,
      params: { structured_output: true },
    })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao registrar prompt: ${error.message}`)
  return data.id
}

interface ComentarioParaAnalise {
  id: string
  text: string | null
  username: string | null
  instagram_user_id: string | null
  instagram_media: { caption: string | null; media_product_type: string | null; published_at: string } | null
}

/**
 * Analisa um lote de comentários pendentes.
 *
 * Sequencial de propósito: em shadow mode não há pressa, e serializar mantém o
 * custo previsível e o rate limit longe. Quando a Etapa 6 liberar automação,
 * este é o ponto para introduzir a Batch API (50% mais barata) no acervo antigo.
 */
export async function analisarPendentes(limite = 20) {
  const promptId = await garantirPromptRegistrado()

  const { data: comentarios, error } = await db()
    .from('instagram_comments')
    .select(
      'id,text,username,instagram_user_id,instagram_media:media_id(caption,media_product_type,published_at)',
    )
    .eq('analysis_status', 'PENDING')
    .eq('is_from_account', false)
    .is('deleted_at', null)
    .not('text', 'is', null)
    .order('commented_at', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`Falha ao ler comentários: ${error.message}`)

  const resultado = { analisados: 0, falhas: 0, custoEstimadoUSD: 0 }

  for (const c of (comentarios ?? []) as unknown as ComentarioParaAnalise[]) {
    await db()
      .from('instagram_comments')
      .update({ analysis_status: 'ANALYZING' })
      .eq('id', c.id)

    try {
      const contexto = await montarContexto(c)
      const inicio = Date.now()

      const resposta = await anthropic().messages.parse({
        model: MODELO_PADRAO,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(Analise),
        },
        messages: [{ role: 'user', content: contexto.prompt }],
      })

      const latencia = Date.now() - inicio
      const analise = resposta.parsed_output
      if (!analise) throw new Error('resposta sem saída estruturada')

      await gravarAnalise({
        comentario: c,
        analise,
        promptId,
        contexto,
        uso: {
          entrada: resposta.usage.input_tokens,
          saida: resposta.usage.output_tokens,
          latenciaMs: latencia,
        },
      })

      resultado.analisados += 1
      // Opus 5: $5/MTok entrada, $25/MTok saída.
      resultado.custoEstimadoUSD +=
        (resposta.usage.input_tokens * 5 + resposta.usage.output_tokens * 25) / 1_000_000
    } catch (e) {
      resultado.falhas += 1
      await db()
        .from('instagram_comments')
        .update({ analysis_status: 'FAILED' })
        .eq('id', c.id)
      await db()
        .from('comment_analyses')
        .insert({
          comment_id: c.id,
          model: MODELO_PADRAO,
          prompt_id: promptId,
          prompt_name: PROMPT_NOME,
          prompt_version: PROMPT_VERSAO,
          error_message: e instanceof Error ? e.message.slice(0, 400) : String(e),
        })
    }
  }

  return resultado
}

async function montarContexto(c: ComentarioParaAnalise) {
  let historico = { comentariosAnteriores: 0, jaRecebeuMensagem: false, ultimaIntencao: null as string | null }
  let anteriores: string[] = []

  if (c.instagram_user_id) {
    const { data: pessoa } = await db()
      .from('instagram_users')
      .select('comments_count,private_replies_count,last_intent')
      .eq('instagram_user_id', c.instagram_user_id)
      .maybeSingle()

    if (pessoa) {
      historico = {
        comentariosAnteriores: Math.max((pessoa.comments_count ?? 1) - 1, 0),
        jaRecebeuMensagem: (pessoa.private_replies_count ?? 0) > 0,
        ultimaIntencao: pessoa.last_intent,
      }
    }

    const { data: outros } = await db()
      .from('instagram_comments')
      .select('text')
      .eq('instagram_user_id', c.instagram_user_id)
      .neq('id', c.id)
      .not('text', 'is', null)
      .order('commented_at', { ascending: false })
      .limit(5)
    anteriores = (outros ?? []).map((o) => o.text as string)
  }

  const entrada = {
    comentario: c.text ?? '',
    username: c.username,
    legenda: c.instagram_media?.caption ?? null,
    tipoConteudo: c.instagram_media?.media_product_type ?? null,
    publicadoEm: c.instagram_media?.published_at ?? null,
    historicoPessoa: historico,
    comentariosAnterioresTexto: anteriores,
  }

  return { prompt: montarPromptUsuario(entrada), entrada }
}

async function gravarAnalise(args: {
  comentario: ComentarioParaAnalise
  analise: Analise
  promptId: string
  contexto: { prompt: string; entrada: unknown }
  uso: { entrada: number; saida: number; latenciaMs: number }
}) {
  const { comentario: c, analise: a, promptId, contexto, uso } = args

  // Trava de segurança independente da IA: mesmo que ela decida enviar, uma
  // intenção da lista never-auto vira revisão humana. A decisão do modelo é
  // preservada em raw_response para auditoria.
  const forcaRevisao =
    NUNCA_AUTOMATICO.includes(a.intencao as Intencao) || a.risco === 'alto' || a.exige_humano

  const decisao = forcaRevisao ? 'HOLD_FOR_REVIEW' : DECISAO_DB[a.decisao]
  const motivo = forcaRevisao
    ? `${a.decisao_motivo} — elevado para revisão humana por intenção/risco (regra do sistema, não do modelo)`
    : a.decisao_motivo

  const { data: analiseSalva, error } = await db()
    .from('comment_analyses')
    .insert({
      comment_id: c.id,
      model: MODELO_PADRAO,
      prompt_id: promptId,
      prompt_name: PROMPT_NOME,
      prompt_version: PROMPT_VERSAO,
      intent: a.intencao,
      intent_confidence: Math.min(Math.max(a.confianca, 0), 1),
      secondary_intents: a.intencoes_secundarias,
      sentiment: a.sentimento,
      language: a.idioma,
      risk_level: RISCO_DB[a.risco],
      risk_reasons: a.risco_motivos,
      requires_human: forcaRevisao,
      suggested_public_reply: a.resposta_publica,
      suggested_private_reply: a.mensagem_privada,
      cta_strategy: a.cta_estrategia,
      cta_included: Boolean(a.mensagem_privada && a.cta_estrategia),
      decision: decisao,
      decision_reason: motivo,
      input_snapshot: contexto as never,
      raw_response: a as never,
      tokens_in: uso.entrada,
      tokens_out: uso.saida,
      latency_ms: uso.latenciaMs,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao gravar análise: ${error.message}`)

  // Ações em SHADOW: registradas, visíveis no painel, incapazes de sair.
  // O worker recusa qualquer status que não seja QUEUED.
  const acoes: Array<{ tipo: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'; texto: string }> = []
  if (a.resposta_publica) acoes.push({ tipo: 'PUBLIC_REPLY', texto: a.resposta_publica })
  if (a.mensagem_privada) acoes.push({ tipo: 'PRIVATE_REPLY', texto: a.mensagem_privada })

  if (acoes.length > 0) {
    await db()
      .from('comment_actions')
      .insert(
        acoes.map((x) => ({
          comment_id: c.id,
          analysis_id: analiseSalva.id,
          action_type: x.tipo,
          mode: 'SHADOW' as const,
          status: 'SHADOW' as const,
          generated_text: x.texto,
          skip_reason: 'SHADOW_MODE: gerado para revisão, nunca enviado',
        })),
      )
  }

  await db()
    .from('instagram_comments')
    .update({ analysis_status: 'ANALYZED' })
    .eq('id', c.id)

  if (c.instagram_user_id) {
    await db().rpc('recalcular_contadores_pessoas', { ids: [c.instagram_user_id] })
  }
}
