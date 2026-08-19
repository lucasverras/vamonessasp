import 'server-only'

/**
 * Fast-path local para comentário SÓ DE EMOJI — 23% do corpus medido.
 *
 * Por que sem IA: espelhar "😍😍" não é interpretação, é reflexo. A chamada
 * de LLM custava 3,3s + US$0,005 para produzir o que uma regra produz em 0ms.
 * Por que é seguro: emoji puro não carrega reclamação, sarcasmo detectável,
 * pergunta nem fato — o pior caso é um espelho sem graça, nunca uma resposta
 * errada. Texto (qualquer letra/dígito) NUNCA entra aqui.
 *
 * Variação sem previsibilidade idiota: o pool de cada classe é escolhido por
 * hash do id do comentário — determinístico (replay do webhook dá a mesma
 * resposta) mas distribuído (pessoas diferentes veem respostas diferentes).
 */

const POOLS: Array<[RegExp, string[]]> = [
  [/[❤🧡💛💚💙💜🖤🤍🤎💕💖💗💓💞💘🫶]/u, ['❤️❤️', '🫶', '😍❤️', '❤️🙌']],
  [/[🔥]/u, ['🔥🔥', '🙌🔥', '🔥😮‍💨']],
  [/[😍🤩😻]/u, ['😍😍', '❤️😍', '🫶😍']],
  [/[👏]/u, ['👏👏', '👏❤️', '🙌👏']],
  [/[😂🤣💀]/u, ['😂😂', '😂😂😂', '🤣🤣']],
  [/[🙌🙏]/u, ['🙌🙌', '🙌❤️']],
  [/[🤤😋🍤🦀🍔🍕]/u, ['🤤🤤', '😋🤤', '🤤❤️']],
  [/[😮😱🤯]/u, ['😮😮', '🤯']],
]

/** Emoji/símbolos apenas — qualquer letra ou dígito desclassifica. */
export function ehSoEmoji(texto: string | null): boolean {
  if (!texto) return false
  const t = texto.trim()
  if (!t || t.length > 40) return false
  if (/[\p{L}\p{N}]/u.test(t)) return false
  return /\p{Extended_Pictographic}/u.test(t)
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function espelharEmoji(texto: string, seed: string): string {
  const h = hash(seed)
  for (const [re, pool] of POOLS) {
    if (re.test(texto)) return pool[h % pool.length]!
  }
  // Emoji fora das classes conhecidas: ecoa os dois primeiros — espelho puro.
  const emojis = [...texto.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0])
  return emojis.slice(0, 2).join('') || '❤️'
}
