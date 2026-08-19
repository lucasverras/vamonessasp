import 'server-only'
import OpenAI from 'openai'
import { z } from 'zod'
import { zodTextFormat } from 'openai/helpers/zod'
import { decidirDestino, lerConfigAutomacao } from '../automation/decidir'
import { gateDmParaIgsid } from '../instagram/follow-status'
import { contemCtaDeFollow, exemplosDeTom, pareceRespostaEsquiva } from './respostas'
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
 * Provedor: OpenAI, por escolha do dono do projeto.
 *
 * Modelo padrão gpt-5.6-terra ($2/$12 por MTok): o meio da família 5.6. Luna
 * custa dez vezes menos ($0.20/$1.20) e é a troca óbvia se o custo apertar — mas
 * a tarefa aqui envolve ironia e ambiguidade, que é exatamente onde um modelo
 * mais raso erra, e errar aqui significa mandar a mensagem errada para uma pessoa
 * real. Sol ($5/$30) só se a classificação se mostrar insuficiente.
 *
 * Configurável por linha em ai_prompts.model, e comment_analyses.model registra
 * qual modelo produziu cada análise — então dá para rodar lotes em modelos
 * diferentes e comparar antes de decidir.
 */

const MODELO_PADRAO = 'gpt-5.6-terra'

/** Preço por milhão de tokens, para o custo estimado do painel. */
const PRECO_POR_MTOK: Record<string, { entrada: number; saida: number }> = {
  'gpt-5.6-sol': { entrada: 5, saida: 30 },
  'gpt-5.6-terra': { entrada: 2, saida: 12 },
  'gpt-5.6-luna': { entrada: 0.2, saida: 1.2 },
}

export function custoEstimado(modelo: string, entrada: number, saida: number): number {
  const p = PRECO_POR_MTOK[modelo] ?? PRECO_POR_MTOK[MODELO_PADRAO]!
  return (entrada * p.entrada + saida * p.saida) / 1_000_000
}

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
  /** Código legível por máquina: MISSING_INFORMATION:parking,
   *  PRICE_NOT_AVAILABLE, AMBIGUOUS_QUESTION, COMPLAINT, SENSITIVE,
   *  LOW_CONFIDENCE, CONFLICTING_SOURCES, OK. */
  decisao_motivo_codigo: z.string(),
  /** Inventário honesto do contexto: o que EXISTIA (endereco, preco, legenda…) */
  fatos_disponiveis: z.array(z.string()),
  /** …e o que FALTOU para responder (parking, preco_domingo…). */
  fatos_faltando: z.array(z.string()),
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

let cliente: OpenAI | null = null
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY ausente. A análise por IA não roda sem ela; o resto do sistema funciona.',
    )
  }
  cliente ??= new OpenAI()
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
  media_id: string | null
  commented_at: string | null
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
  // Falta de chave é erro de CONFIGURAÇÃO, não falha de análise. Checado aqui,
  // antes de tocar em qualquer comentário: sem isso o cron rodava sem a chave na
  // Vercel, cada comentário entrava no catch e virava FAILED — e como o worker só
  // pega PENDING, 153 comentários ficaram presos para sempre por uma variável de
  // ambiente. Abortar alto e não mexer em nada é o comportamento correto.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY ausente no ambiente. Nenhum comentário foi tocado — ' +
        'configure a variável e refaça o deploy (a Vercel só aplica env vars em deploys novos).',
    )
  }

  const promptId = await garantirPromptRegistrado()

  const { data: comentarios, error } = await db()
    .from('instagram_comments')
    .select(
      'id,text,username,instagram_user_id,media_id,commented_at,instagram_media:media_id(caption,media_product_type,published_at)',
    )
    .eq('analysis_status', 'PENDING')
    .eq('is_from_account', false)
    .is('deleted_at', null)
    .not('text', 'is', null)
    .order('commented_at', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`Falha ao ler comentários: ${error.message}`)

  const resultado = { analisados: 0, falhas: 0, custoEstimadoUSD: 0 }
  const fila = (comentarios ?? []) as unknown as ComentarioParaAnalise[]

  /**
   * Cada análise é independente das outras, então esperar 3,6s por comentário
   * antes de começar o próximo era desperdício puro: um lote de 20 levava ~72s.
   * Com CONCORRENCIA=6 o mesmo lote leva ~13s.
   *
   * O teto é deliberado e não é enfeite: sem limite, um lote grande abriria
   * dezenas de requisições simultâneas e o que ganhamos em tempo perderíamos em
   * rate limit da OpenAI — e rate limit aqui vira análise perdida, não fila.
   */
  const CONCORRENCIA = 6
  let cursor = 0

  const trabalhador = async () => {
    for (;;) {
      const c = fila[cursor++]
      if (!c) return
      await processarUm(c)
    }
  }

  async function processarUm(c: ComentarioParaAnalise) {
    await db()
      .from('instagram_comments')
      .update({ analysis_status: 'ANALYZING' })
      .eq('id', c.id)

    // Spam inequívoco não paga IA: classificação heurística, sem ação, direto
    // para ANALYZED. Se a heurística errar, o painel mostra e a pessoa continua
    // operável manualmente.
    const filtro = preFiltro(c.text ?? '')
    if (filtro) {
      await db().from('comment_analyses').insert({
        comment_id: c.id,
        model: 'heuristica-v1',
        prompt_id: promptId,
        prompt_name: PROMPT_NOME,
        prompt_version: PROMPT_VERSAO,
        intent: filtro.intent,
        intent_confidence: 1,
        risk_level: 'LOW',
        requires_human: false,
        decision: 'SKIP',
        decision_reason: `pré-filtro: ${filtro.motivo}`,
        tokens_in: 0,
        tokens_out: 0,
        latency_ms: 0,
      })
      await db().from('instagram_comments').update({ analysis_status: 'ANALYZED' }).eq('id', c.id)
      resultado.analisados += 1
      return
    }

    try {
      const contexto = await montarContexto(c)
      const inicio = Date.now()

      // Responses API com json_schema em modo strict: a saída é validada
      // contra o schema no servidor, então não há parsing frágil nem retry por
      // JSON malformado.
      const resposta = await openai().responses.parse({
        model: MODELO_PADRAO,
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content: contexto.prompt }],
        text: { format: zodTextFormat(Analise, 'analise_comentario') },
      })

      const latencia = Date.now() - inicio
      let analise = resposta.output_parsed
      if (!analise) throw new Error('resposta sem saída estruturada')
      let tokensIn = resposta.usage?.input_tokens ?? 0
      let tokensOut = resposta.usage?.output_tokens ?? 0

      // §40: resposta que serviria para cem comentários diferentes não serve
      // para este. UMA regeneração com instrução extra — nunca loop — e, se
      // continuar solta, quem decide é você (revisão), não o modelo.
      const entrada = contexto.entrada as {
        comentario: string
        legenda: string | null
        fatosDoConteudo?: Record<string, string | null>
      }
      const ancorada = () =>
        respostaAncoradaNoComentario({
          intent: analise!.intencao,
          resposta: analise!.resposta_publica,
          comentario: entrada.comentario,
          legenda: entrada.legenda,
          fatos: entrada.fatosDoConteudo ?? {},
        })
      // Dois vetos estruturais na resposta pública, com UMA regeneração:
      // genérica demais para pergunta factual, ou CTA de follow (proibição
      // absoluta: público conversa, DM pede follow).
      let aindaGenerica = false
      const problema = () =>
        !ancorada()
          ? 'Sua resposta anterior era genérica demais — serviria para qualquer comentário. Reescreva ancorando no que ESTA pessoa perguntou, usando o fato concreto do contexto. Se o fato não existir no contexto, a decisão é aguardar_revisao.'
          : contemCtaDeFollow(analise!.resposta_publica)
            ? 'Sua resposta pública pede follow — isso é PROIBIDO em público (o convite pertence à DM, que é template do sistema). Reescreva a resposta pública apenas conversando, sem qualquer pedido de seguir.'
            : null
      const instrucaoRetry = problema()
      if (instrucaoRetry) {
        const retry = await openai().responses.parse({
          model: MODELO_PADRAO,
          instructions: SYSTEM_PROMPT,
          input: [
            { role: 'user', content: contexto.prompt },
            { role: 'user', content: instrucaoRetry },
          ],
          text: { format: zodTextFormat(Analise, 'analise_comentario') },
        })
        if (retry.output_parsed) {
          analise = retry.output_parsed
          tokensIn += retry.usage?.input_tokens ?? 0
          tokensOut += retry.usage?.output_tokens ?? 0
        }
        aindaGenerica = !ancorada() || contemCtaDeFollow(analise!.resposta_publica)
      }

      await gravarAnalise({
        comentario: c,
        analise,
        promptId,
        contexto,
        forcarRevisaoPorGenerica: aindaGenerica,
        uso: {
          entrada: tokensIn,
          saida: tokensOut,
          latenciaMs: latencia,
        },
      })

      resultado.analisados += 1
      resultado.custoEstimadoUSD += custoEstimado(MODELO_PADRAO, tokensIn, tokensOut)
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

  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, trabalhador))

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

  // O que JÁ respondemos neste conteúdo — a IA precisa ver para variar.
  let nossasRespostas: string[] = []
  if (c.media_id) {
    const { data: enviadas } = await db()
      .from('comment_actions')
      .select('final_text,generated_text')
      .eq('media_id', c.media_id)
      .eq('action_type', 'PUBLIC_REPLY')
      .in('status', ['SENT', 'QUEUED', 'SENDING'])
      .order('created_at', { ascending: false })
      .limit(5)
    nossasRespostas = (enviadas ?? [])
      .map((e) => (e.final_text ?? e.generated_text ?? '').trim())
      .filter(Boolean)
  }

  // Fatos estruturados do content DESTE media — fonte nº 1 da hierarquia.
  // O vínculo é seed_media_id: estrutural, nunca por semelhança de texto,
  // então endereço de um Reel jamais vaza para outro.
  let fatos: Record<string, string | null> = {}
  if (c.media_id) {
    const { data: content } = await db()
      .from('contents')
      .select('business_name,address,neighborhood,city,price,opening_hours,instagram_handle,website,notes')
      .eq('seed_media_id', c.media_id)
      .maybeSingle()
    if (content) {
      fatos = {
        estabelecimento: content.business_name,
        endereco: content.address,
        bairro: content.neighborhood,
        cidade: content.city,
        preco: content.price,
        horario: content.opening_hours,
        instagram: content.instagram_handle,
        site: content.website,
        observacoes: content.notes,
      }
    }
  }

  const entrada = {
    comentario: c.text ?? '',
    username: c.username,
    legenda: c.instagram_media?.caption ?? null,
    tipoConteudo: c.instagram_media?.media_product_type ?? null,
    publicadoEm: c.instagram_media?.published_at ?? null,
    historicoPessoa: historico,
    comentariosAnterioresTexto: anteriores,
    fatosDoConteudo: fatos,
    nossasRespostasNoConteudo: nossasRespostas,
    // Sem intenção ainda (a IA decide); os exemplos cobrem o caso mais comum.
    exemplosDeTom: exemplosDeTom('elogio', c.id),
  }

  return { prompt: montarPromptUsuario(entrada), entrada }
}

/**
 * "Esta resposta responde a ESTE comentário?" — o teste do §40.
 *
 * Para intenção factual, a resposta precisa carregar substância: um número
 * (preço, altura de rua) ou pelo menos uma palavra de conteúdo vinda do
 * comentário, da legenda ou dos fatos. "Que demais 😍" para "onde fica?"
 * falha aqui mesmo que o modelo tenha decidido enviar.
 */
export function respostaAncoradaNoComentario(args: {
  intent: string
  resposta: string | null
  comentario: string
  legenda: string | null
  fatos: Record<string, string | null>
}): boolean {
  const FACTUAIS = ['localizacao', 'preco', 'horario', 'duvida']
  if (!FACTUAIS.includes(args.intent)) return true
  if (!args.resposta) return true // sem resposta não há o que ancorar

  const r = args.resposta.toLowerCase()
  if (/\d/.test(r)) return true // número = fato concreto (preço, número da rua)

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
  const fonte = new Set(
    norm(
      `${args.comentario} ${args.legenda ?? ''} ${Object.values(args.fatos).filter(Boolean).join(' ')}`,
    )
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )
  return norm(r)
    .split(/\s+/)
    .some((w) => w.length >= 4 && fonte.has(w))
}

/**
 * Pré-filtro heurístico: o que dá para decidir com regex não paga IA.
 * Devolve a intenção detectada ou null (segue para o modelo).
 */
export function preFiltro(texto: string): { intent: string; motivo: string } | null {
  const t = texto.trim()
  // Só link, ou golpe clássico de "ganhe X": spam sem ambiguidade.
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return { intent: 'spam', motivo: 'apenas link' }
  if (/ganhe\s+(r\$|\d)|renda extra|lucre .*acessando|invista e ganhe/i.test(t)) {
    return { intent: 'spam', motivo: 'padrão de golpe' }
  }
  if (/^segue de volta\b|^sdv\b/i.test(t)) return { intent: 'spam', motivo: 'troca de follow' }
  return null
}

async function gravarAnalise(args: {
  comentario: ComentarioParaAnalise
  analise: Analise
  promptId: string
  contexto: { prompt: string; entrada: unknown }
  forcarRevisaoPorGenerica?: boolean
  uso: { entrada: number; saida: number; latenciaMs: number }
}) {
  const { comentario: c, analise: a, promptId, contexto, uso } = args

  // Trava de segurança independente da IA: mesmo que ela decida enviar, uma
  // intenção da lista never-auto vira revisão humana. A decisão do modelo é
  // preservada em raw_response para auditoria.
  // Pergunta cuja "resposta" é uma esquiva ("não temos essa informação, vale
  // checar com eles") é falta de fato disfarçada de resposta — vai para o
  // humano, que provavelmente SABE. Trava do sistema, não do modelo.
  const INTENCOES_FACTUAIS = ['localizacao', 'preco', 'horario', 'duvida']
  const esquiva =
    INTENCOES_FACTUAIS.includes(a.intencao) &&
    (pareceRespostaEsquiva(a.resposta_publica) || pareceRespostaEsquiva(a.mensagem_privada))

  const forcaRevisao =
    NUNCA_AUTOMATICO.includes(a.intencao as Intencao) ||
    a.risco === 'alto' ||
    a.exige_humano ||
    esquiva ||
    Boolean(args.forcarRevisaoPorGenerica)

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
      decision_reason_code: a.decisao_motivo_codigo || null,
      facts_available: a.fatos_disponiveis,
      facts_missing: a.fatos_faltando,
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

  // O destino da ação é decidido pela configuração + análise: fila com atraso
  // (auto), revisão humana, ou registro. Ver lib/automation/decidir.ts.
  const cfg = await lerConfigAutomacao()
  const destino = cfg
    ? decidirDestino({
        cfg,
        intent: a.intencao,
        confidence: a.confianca,
        decision: decisao,
        requiresHuman: forcaRevisao,
        commentedAt: c.commented_at ?? new Date(0).toISOString(),
      })
    : ({ status: 'SHADOW', agendadoPara: null, motivo: 'sem configuracao' } as const)

  const acoes: Array<{ tipo: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'; texto: string }> = []
  if (a.resposta_publica) acoes.push({ tipo: 'PUBLIC_REPLY', texto: a.resposta_publica })

  // A DM agora é TEMPLATE do sistema (objetivo: follow) — o modelo só decide
  // SE ela cabe (enviar_ambas/apenas_privada, fora de revisão). O texto vem
  // de automation_settings.dm_template, congelado na ação.
  //
  // O PORTÃO (§31-32, 46) continua: só quem comprovadamente NÃO segue, sem DM
  // nossa em 30 dias. FOLLOWS/UNKNOWN/recente viram registro SKIPPED com o
  // motivo — visível na tela, nunca silencioso. HOLD segura a DM junto.
  const dmCabe =
    !forcaRevisao && (a.decisao === 'enviar_ambas' || a.decisao === 'apenas_privada')
  const textoDm = (a.mensagem_privada ?? cfg?.dm_template ?? '').trim()
  let dmBloqueada: { motivo: string } | null = null
  if (dmCabe && textoDm) {
    const gate = await gateDmParaIgsid(c.instagram_user_id)
    if (gate.pode) acoes.push({ tipo: 'PRIVATE_REPLY', texto: textoDm })
    else dmBloqueada = { motivo: gate.motivo }
  } else if (forcaRevisao && NUNCA_AUTOMATICO.includes(a.intencao as Intencao)) {
    // "Vocês passaram informação errada" NUNCA recebe "segue a gente 💚".
    // Antes essa DM simplesmente não existia; agora existe o REGISTRO com o
    // nome do enum — a tela de Negados mostra o porquê (spec Parte 11/16).
    dmBloqueada = { motivo: 'SENSITIVE_INTERACTION' }
  }

  if (acoes.length > 0) {
    const { error: erroAcoes } = await db()
      .from('comment_actions')
      .insert(
        acoes.map((x) => ({
          comment_id: c.id,
          analysis_id: analiseSalva.id,
          action_type: x.tipo,
          mode: destino.status === 'QUEUED' ? ('AUTO' as const) : ('SHADOW' as const),
          // REGRA DE OURO (spec 18/08): os dois fluxos têm modos separados.
          // RESPOSTA PÚBLICA fica em REVIEW até a IA estar "100% no nosso
          // jeito" — nunca publica sozinha, mesmo em LIVE. DM qualificada
          // (não-seguidor comprovado + 60 dias) segue automática.
          status:
            x.tipo === 'PUBLIC_REPLY' && destino.status === 'QUEUED'
              ? ('PENDING_APPROVAL' as const)
              : destino.status,
          generated_text: x.texto,
          reply_source: 'AI',
          // As colunas da constraint USER+MEDIA: preenchidas SEMPRE, para o
          // banco poder recusar a segunda DM do mesmo par.
          instagram_user_id: c.instagram_user_id,
          media_id: c.media_id ?? null,
          next_attempt_at: destino.agendadoPara ?? new Date().toISOString(),
          skip_reason: destino.status === 'QUEUED' ? null : destino.motivo,
        })),
      )
    // 23505 aqui é a constraint funcionando: outro comentário da mesma pessoa
    // no mesmo conteúdo já reservou a DM. Não é falha de análise.
    if (erroAcoes && erroAcoes.code !== '23505') {
      throw new Error(`Falha ao criar ações: ${erroAcoes.message}`)
    }
    if (erroAcoes?.code === '23505') {
      // A pública pode ter passado e a privada colidido (ou vice-versa); grava
      // uma a uma para não perder a que é legítima.
      for (const x of acoes) {
        const { error: e1 } = await db()
          .from('comment_actions')
          .insert({
            comment_id: c.id,
            analysis_id: analiseSalva.id,
            action_type: x.tipo,
            mode: destino.status === 'QUEUED' ? ('AUTO' as const) : ('SHADOW' as const),
            status: destino.status,
            generated_text: x.texto,
            reply_source: 'AI',
            instagram_user_id: c.instagram_user_id,
            media_id: c.media_id ?? null,
            next_attempt_at: destino.agendadoPara ?? new Date().toISOString(),
            skip_reason: destino.status === 'QUEUED' ? null : destino.motivo,
          })
        if (e1 && e1.code !== '23505') throw new Error(`Falha ao criar ação: ${e1.message}`)
        if (e1?.code === '23505' && x.tipo === 'PRIVATE_REPLY') {
          await db()
            .from('comment_actions')
            .insert({
              comment_id: c.id,
              analysis_id: analiseSalva.id,
              action_type: x.tipo,
              mode: 'SHADOW' as const,
              status: 'SKIPPED' as const,
              generated_text: x.texto,
              reply_source: 'AI',
              skip_reason: 'SKIPPED_DUPLICATE_USER_MEDIA: pessoa já tem DM deste conteúdo',
            })
        }
      }
    }
  }

  // A DM barrada pelo portão vira registro, não silêncio: a tela mostra
  // "DM não sugerida — já segue / status desconhecido / DM recente".
  if (dmBloqueada) {
    await db().from('comment_actions').insert({
      comment_id: c.id,
      analysis_id: analiseSalva.id,
      action_type: 'PRIVATE_REPLY',
      mode: 'SHADOW',
      status: 'SKIPPED',
      generated_text: textoDm,
      reply_source: 'AI',
      skip_reason: dmBloqueada.motivo,
    })
  }

  await db()
    .from('instagram_comments')
    .update({ analysis_status: 'ANALYZED' })
    .eq('id', c.id)

  if (c.instagram_user_id) {
    await db().rpc('recalcular_contadores_pessoas', { ids: [c.instagram_user_id] })
  }
}
