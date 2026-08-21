import 'server-only'

/**
 * Biblioteca de respostas-base, por categoria de interação.
 *
 * NÃO é um dicionário de respostas prontas que o sistema cola: são exemplos de
 * TOM que entram no prompt para a IA adaptar ao contexto. A regra de ouro do
 * produto continua: fato vem da legenda/banco, nunca da imaginação — a
 * biblioteca só ensina o jeito de falar.
 *
 * Curta, informal, brasileira, sem SAC. Emoji às vezes, não sempre.
 */

export const BIBLIOTECA: Record<string, readonly string[]> = {
  elogio_geral: [
    'Que bom que curtiu! 😍',
    'Esse aí vale muito a visita!',
    'Já coloca na lista 👀',
    'Bom demais né?',
    'Esse é daqueles imperdíveis!',
  ],
  elogio_comida: [
    'E olha que ao vivo é ainda melhor 😋',
    'Dá vontade só de lembrar!',
    'A gente também não resistiu!',
  ],
  interesse_em_visitar: [
    'Depois conta pra gente o que achou!',
    'Vai sim, vale a pena!',
    'Já salva pra não esquecer 👀',
    'Depois volta aqui pra contar!',
    'Partiu! 😄',
  ],
  ja_visitou_positivo: [
    'Bom demais né? 😍',
    'A gente também amou!',
    'Esse lugar não decepciona!',
  ],
  marcacao_de_amigo: [
    'Já marca a data 👀',
    'Partiu? 😂',
    'Essa dupla tem que ir!',
    'Leva mesmo! 😄',
  ],
  risada: ['😂😂', 'A gente também riu disso 😂', 'kkkk demais né'],
  agradecimento: ['Nós que agradecemos! 💚', 'Tamo junto! 💚'],
  // Perguntas objetivas não têm template: a resposta É o fato (endereço, preço,
  // horário), e fato vem do contexto ou não existe resposta automática.
} as const

/** Mapa intenção → categoria da biblioteca. Fora do mapa = sem exemplos. */
export function categoriaDaIntencao(intent: string): keyof typeof BIBLIOTECA | null {
  switch (intent) {
    case 'elogio':
      return 'elogio_geral'
    case 'interesse_em_visitar':
      return 'interesse_em_visitar'
    case 'marcacao_de_amigo':
      return 'marcacao_de_amigo'
    case 'comentario_generico':
      return 'risada'
    default:
      return null
  }
}

/**
 * Exemplos de tom para o prompt, embaralhados de forma determinística pelo id
 * do comentário — dois comentários vizinhos recebem exemplos em ordem
 * diferente, o que já empurra a variação sem sorteio de verdade.
 */
export function exemplosDeTom(intent: string, seed: string): string[] {
  const cat = categoriaDaIntencao(intent)
  if (!cat) return []
  const base = [...BIBLIOTECA[cat]!]
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  // rotação determinística
  const corte = h % base.length
  return [...base.slice(corte), ...base.slice(0, corte)].slice(0, 3)
}

/**
 * Detecta resposta-esquiva: o padrão "não temos essa informação / consulte o
 * estabelecimento" que o produto PROÍBE como resposta automática. Se o modelo
 * gerar uma dessas para uma pergunta, a decisão vira revisão humana — trava
 * determinística, não depende do prompt ser obedecido. Achado da auditoria
 * adversarial de 17/08/2026: o modelo respondeu "vale checar direto com eles"
 * para "tem estacionamento?" e o sistema enfileirou.
 */
/** Regra do Lucas (20/08): UM emoji só, em tudo. Mantém o primeiro, remove os
 *  demais (respeita sequências compostas: tons de pele, ZWJ, bandeiras). */
export function umEmojiSo(texto: string | null): string | null {
  if (!texto) return texto
  const seg = new Intl.Segmenter('pt', { granularity: 'grapheme' })
  let vistos = 0
  let out = ''
  for (const { segment } of seg.segment(texto)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) {
      vistos += 1
      if (vistos > 1) continue
    }
    out += segment
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.!?,])/g, '$1').trim()
}

const PALAVROES =
  /\b(porra|caralh[oa]|carai[oa]?|krl|merda|puta|putaria|fod[ae][-\s]?se|foda|fod[ao]|fdp|pqp|vsf|vtnc|cu|buceta|arrombad[oa]|desgra[çc]a|filh[oa] da puta|bosta|viado|otári[oa]|babaca|idiota)\b/i
/** Regra do Lucas (20/08): nunca palavrão, mesmo que o comentário use. */
export function contemPalavrao(texto: string | null): boolean {
  return Boolean(texto && PALAVROES.test(texto))
}

export function pareceRespostaEsquiva(texto: string | null): boolean {
  if (!texto) return false
  return /n[ãa]o (temos|tenho|sei|sabemos)|informa[çc][ãa]o (confirmada|precisa)|vale (checar|confirmar|consultar)|consulte? (direto|o local|o estabelecimento)|melhor confirmar|liga(r)? (l[áa]|pra eles)|vamos confirmar|vou confirmar|confirmar (essa|a) informa|te avis(amos|o)|assim que (soubermos|souber)|confirma(r)? (com eles|direto|l[áa])|(pela|no|por) (dm|direct)|chama (eles|l[áa])|manda (uma )?(mensagem|msg) (pra|para) eles|pergunta (direto )?(pra|para) eles|com eles (no|pelo|pela) (direct|dm|whats)/i.test(
    texto,
  )
}

/**
 * CTA de follow em RESPOSTA PÚBLICA é proibido — a regra absoluta do produto:
 * público = conversa, DM = follow. Detecta o pedido de acompanhamento
 * ("segue a gente", "não esquece de seguir", "follow"), sem punir usos
 * legítimos das palavras ("seguindo a dica", "em seguida").
 */
export function contemCtaDeFollow(texto: string | null): boolean {
  if (!texto) return false
  const t = texto.toLowerCase()
  return (
    /\bsegue\s+(a gente|o @|n[óo]s|o vamo|nosso)/i.test(t) ||
    /\b(n[ãa]o (esquece|deixa) de seguir|bora seguir|j[áa] segue\b)/i.test(t) ||
    /\bseguir\s+(a gente|o @|o perfil|o vamo|nosso)/i.test(t) ||
    /\bfollow\b/i.test(t) ||
    /\bacompanha\s+(a gente|o @|o vamo|nosso)/i.test(t) ||
    /@vamonessasp\b.*\b(pra n[ãa]o perder|para n[ãa]o perder|seguir|segue)/i.test(t)
  )
}

/**
 * Validação final antes de publicar — a última linha de defesa, estrutural e
 * barata (sem IA). Devolve o motivo da recusa, ou null para aprovado.
 */
export function validarRespostaPublica(
  texto: string,
  respostasRecentesNoMedia: string[],
  opcoes?: {
    /** Resposta ESCRITA POR HUMANO: as regras de estilo da automação (CTA,
     *  tom) não se aplicam — o humano decide o próprio texto. Comprimento e
     *  vazio continuam valendo, porque são limite da plataforma/bom senso. */
    autorHumano?: boolean
  },
): string | null {
  // Regras de 20/08: palavrão nunca; um emoji só (o pipeline normaliza, isto é a rede).
  if (contemPalavrao(texto)) return 'PALAVRAO'
  if ([...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(texto)].filter((g) => /\p{Extended_Pictographic}/u.test(g.segment)).length > 1) return 'MAIS_DE_UM_EMOJI'
  const t = texto.trim()
  if (!t) return 'VAZIA'
  if (t.length > 240) return 'LONGA_DEMAIS'
  if (opcoes?.autorHumano) return null
  // A regra absoluta: pedido de follow não sai em comentário público, nunca.
  if (contemCtaDeFollow(t)) return 'CTA_DE_FOLLOW_EM_PUBLICO'
  // Menção a IA/bot quebra o disfarce e a confiança.
  if (/\b(ia\b|intelig[êe]ncia artificial|assistente virtual|bot\b|chatbot)/i.test(t)) {
    return 'MENCIONA_IA'
  }
  if (/prezado|agradecemos imensamente|estimado cliente/i.test(t)) return 'TOM_DE_SAC'
  // Repetição literal do que acabamos de dizer no mesmo conteúdo.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  if (respostasRecentesNoMedia.some((r) => norm(r) === norm(t))) return 'REPETIDA_NO_CONTEUDO'
  return null
}
