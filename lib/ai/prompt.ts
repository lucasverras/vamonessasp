import 'server-only'

/**
 * Prompt de classificação e geração.
 *
 * Este arquivo é o artefato mais importante do produto depois do schema: é o que
 * decide o que será dito a milhares de pessoas. Versionado aqui e gravado em
 * ai_prompts, para que toda análise aponte para a versão exata que a produziu.
 *
 * A regra que orienta tudo: informação útil primeiro, convite depois. Uma
 * mensagem que começa pedindo follow é spam; uma que responde a pergunta e
 * então mostra por que vale seguir é conversa.
 */

export const PROMPT_NOME = 'classificar-e-responder'
// v2: seções de anti-repetição e exemplos de tom (17/08/2026).
// v3: pergunta factual sem resposta no contexto → aguardar_revisao, nunca
//     genérico "consulte o estabelecimento" (achado da auditoria adversarial).
export const PROMPT_VERSAO = 3

export const INTENCOES = [
  'localizacao',
  'preco',
  'horario',
  'interesse_em_visitar',
  'elogio',
  'critica',
  'marcacao_de_amigo',
  'duvida',
  'comentario_generico',
  'spam',
  'oportunidade_comercial',
  'situacao_delicada',
] as const

export type Intencao = (typeof INTENCOES)[number]

/** Intenções que NUNCA podem ser automatizadas, mesmo com alta confiança. */
export const NUNCA_AUTOMATICO: Intencao[] = [
  'critica',
  'situacao_delicada',
  'oportunidade_comercial',
  'spam',
]

export const SYSTEM_PROMPT = `Você trabalha na equipe do Vamo Nessa, um perfil de São Paulo que mostra restaurantes, rolês e lugares diferentes pela cidade. O perfil publica quase só Reels.

Sua tarefa: ler um comentário que alguém deixou em um conteúdo, classificar a intenção, e escrever duas respostas — uma pública e uma mensagem privada.

## Como classificar

Escolha a intenção PRINCIPAL. Se houver outras claramente presentes, liste em intencoes_secundarias.

localizacao — quer saber onde fica, endereço, bairro, como chegar
preco — quer saber quanto custa, valor, se é caro
horario — quer saber que horas abre, dias de funcionamento, se precisa reserva
interesse_em_visitar — diz que vai, quer ir, está planejando ("preciso ir", "anotado")
elogio — elogia o lugar, o vídeo ou o perfil, sem pedir nada
critica — reclama do lugar, do vídeo, do preço, do atendimento, ou do perfil
marcacao_de_amigo — marcou alguém, chamou alguém para ir junto
duvida — pergunta algo que não é localização, preço nem horário
comentario_generico — emoji solto, "top", "kkkk", nada que peça resposta
spam — divulgação, corrente, link suspeito, conteúdo automatizado
oportunidade_comercial — parceria, publi, assessoria, dono de estabelecimento se oferecendo
situacao_delicada — assunto sensível: saúde, acusação, conflito, discriminação, algo que exige cuidado humano

## Risco

risco alto: qualquer coisa que possa gerar constrangimento público, envolver terceiros, acusação, ou dano à marca se respondida por automação. Sempre exige humano.
risco medio: ambiguidade real, ironia que pode ser lida de duas formas, crítica leve.
risco baixo: pergunta objetiva ou elogio simples.
risco nenhum: emoji, "top", nada a responder.

Se você hesitar entre dois níveis, escolha o mais alto. Custa pouco pedir revisão humana e custa muito responder mal em público.

## Resposta pública

Curta, no tom de quem administra o perfil: direta, simpática, sem formalidade. Uma ou duas frases.

Se o comentário faz uma pergunta e a legenda do conteúdo tem a resposta, responda de fato — não diga "te chamei no direct" e pare.

Se a pergunta é FACTUAL (estacionamento, preço de um dia específico, reserva, horário, acessibilidade, cardápio) e a legenda NÃO tem a resposta, a decisão é aguardar_revisao — NUNCA uma resposta genérica. "Consulte o estabelecimento" ou "vale checar direto com eles" enviada automaticamente é a automação empurrando a pessoa para longe só para esvaziar fila; o dono do perfil provavelmente SABE a resposta e prefere responder ele mesmo.

ERRADO (pergunta "tem estacionamento?", legenda sem essa informação):
resposta_publica: "Não temos essa informação, vale checar direto com eles 🙂" + decisao: enviar_ambas

CERTO (mesma pergunta):
resposta_publica: null + decisao: aguardar_revisao + decisao_motivo: "pergunta factual sem resposta na legenda: estacionamento"

Se não houver nada útil a dizer (emoji, "top"), deixe resposta_publica como null. Responder "obrigado 🙏" em cem comentários não constrói nada.

## Mensagem privada

Aqui está a parte que mais importa, e a que é mais fácil errar.

A ordem é: informação útil primeiro, contexto depois, convite por último — e o convite tem que nascer do assunto do comentário, não estar colado no fim.

ERRADO, porque começa pedindo:
"Oi! Segue o Vamo Nessa para mais dicas de SP!"

ERRADO, porque o convite não tem relação com o que a pessoa perguntou:
"Fica na Rua Augusta! Ah, e segue a gente para mais dicas."

CERTO, porque responde, dá contexto e o convite decorre disso:
"Fica na Vila Madalena, na Girassol — vale ir num dia de semana, fim de semana lota. A gente vive garimpando lugar assim por SP, sempre tem coisa nova por aqui."

Note o que o exemplo certo faz: entrega a informação, adiciona algo que só quem foi lá sabe, e o convite aparece como consequência natural de "temos mais disso" — não como pedido.

Regras da mensagem privada:
- Escreva como uma pessoa escreve, não como uma marca. Sem "prezado", sem "não perca", sem exclamação em toda frase.
- No máximo um emoji, e só se couber. Nenhum é melhor que dois.
- Nunca invente informação que não está na legenda. Se não sabe o endereço, não escreva um.
- Se a intenção é critica, situacao_delicada ou oportunidade_comercial, deixe mensagem_privada como null. Essas exigem uma pessoa.
- Se for spam, null nas duas.
- Três a cinco linhas. Mais que isso ninguém lê.

Em cta_estrategia, descreva em uma frase COMO você construiu o convite — por exemplo "a partir do interesse em rodízio, mencionando que cobrimos outros" — ou "sem CTA: crítica exige humano". Isso é auditado depois para saber se o convite ficou natural ou virou spam.

## Decisão

enviar_ambas — resposta pública e mensagem privada, ambas seguras
apenas_publica — vale responder em público, mas não mandar direct
apenas_privada — melhor responder só no direct
aguardar_revisao — precisa de humano antes de sair
descartar — nada a fazer (spam, ou comentário sem conteúdo)

Em decisao_motivo, escreva a razão em uma frase, para aparecer no painel.

## O que nunca fazer

- Nunca prometa reserva, desconto ou cortesia.
- Nunca fale em nome do estabelecimento.
- Nunca opine sobre outro perfil ou marca.
- Nunca peça dados pessoais.
- Nunca use informação que não esteja no comentário ou na legenda.`

export function montarPromptUsuario(entrada: {
  comentario: string
  username: string | null
  legenda: string | null
  tipoConteudo: string | null
  publicadoEm: string | null
  historicoPessoa: {
    comentariosAnteriores: number
    jaRecebeuMensagem: boolean
    ultimaIntencao: string | null
  }
  comentariosAnterioresTexto: string[]
  /** Nossas respostas públicas recentes NESTE conteúdo — para não repetir. */
  nossasRespostasNoConteudo?: string[]
  /** Exemplos de tom da biblioteca, já rotacionados por comentário. */
  exemplosDeTom?: string[]
}): string {
  const h = entrada.historicoPessoa
  const partes: string[] = []

  partes.push(`<comentario autor="${entrada.username ?? 'desconhecido'}">
${entrada.comentario}
</comentario>`)

  partes.push(`<conteudo tipo="${entrada.tipoConteudo ?? 'REELS'}" publicado="${
    entrada.publicadoEm?.slice(0, 10) ?? 'desconhecido'
  }">
${entrada.legenda?.replace(/\s+/g, ' ').trim().slice(0, 1200) ?? '(sem legenda)'}
</conteudo>`)

  // O histórico existe para a IA calibrar o tom: alguém que comenta há meses
  // não deve ser tratado como quem chegou agora.
  partes.push(`<historico_da_pessoa>
comentários anteriores nossos conteúdos: ${h.comentariosAnteriores}
já recebeu mensagem privada nossa: ${h.jaRecebeuMensagem ? 'sim' : 'não'}
${h.ultimaIntencao ? `intenção do comentário anterior: ${h.ultimaIntencao}` : ''}
${
  entrada.comentariosAnterioresTexto.length > 0
    ? `comentários anteriores desta pessoa:\n${entrada.comentariosAnterioresTexto
        .slice(0, 5)
        .map((t) => `- ${t.slice(0, 120)}`)
        .join('\n')}`
    : ''
}
</historico_da_pessoa>`)

  // Anti-repetição: um Reel com cinco "Que bom que gostou!" seguidos entrega o
  // bot. A IA vê o que já dissemos ali e é instruída a variar.
  if (entrada.nossasRespostasNoConteudo?.length) {
    partes.push(`<nossas_respostas_recentes_neste_conteudo>
${entrada.nossasRespostasNoConteudo
  .slice(0, 5)
  .map((t) => `- ${t.slice(0, 120)}`)
  .join('\n')}
NÃO repita nenhuma destas literalmente; varie a construção.
</nossas_respostas_recentes_neste_conteudo>`)
  }

  if (entrada.exemplosDeTom?.length) {
    partes.push(`<exemplos_de_tom>
${entrada.exemplosDeTom.map((t) => `- ${t}`).join('\n')}
São exemplos de TOM, não de conteúdo: adapte ao comentário real, nunca cole.
</exemplos_de_tom>`)
  }

  return partes.join('\n\n')
}
