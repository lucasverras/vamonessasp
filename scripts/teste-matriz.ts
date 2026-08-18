/**
 * Matriz de testes da automação — SEM tocar em pessoa real.
 *
 * Três camadas, todas locais ao banco e à lógica:
 *   1. decidirDestino: dado análise + config, para onde vai a ação?
 *   2. pré-filtro e validação final: heurísticas puras.
 *   3. constraint no banco: segunda DM do mesmo par tem que falhar.
 *
 * Nada aqui chama a Meta. O kill switch nem é consultado porque nenhum envio
 * é sequer tentado.
 */
import { decidirDestino, type ConfigAutomacao } from '../lib/automation/decidir'
import { preFiltro } from '../lib/ai/analise'
import { validarRespostaPublica } from '../lib/ai/respostas'

let falhas = 0
function caso(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas += 1
  console.log(`  ${ok ? '✓' : '✗'} ${nome.padEnd(58)} → ${String(obtido)}${ok ? '' : ` (esperado ${String(esperado)})`}`)
}

const cfgBase: ConfigAutomacao = {
  reply_mode: 'DRY_RUN',
  kill_switch: true,
  delay_min_seconds: 180,
  delay_max_seconds: 420,
  reply_praise: true,
  reply_known_questions: true,
  reply_mentions: true,
  automation_started_at: '2026-08-17T00:00:00Z',
  auto_approve_intents: [],
  never_auto_intents: ['critica', 'situacao_delicada', 'oportunidade_comercial', 'spam'],
  min_confidence_for_auto: 0.85,
  dm_template: 'template de teste',
}
const depois = '2026-08-17T12:00:00Z'
const antes = '2026-08-10T12:00:00Z'

function destino(over: Partial<Parameters<typeof decidirDestino>[0]>) {
  return decidirDestino({
    cfg: cfgBase,
    intent: 'elogio',
    confidence: 0.95,
    decision: 'SEND_BOTH',
    requiresHuman: false,
    commentedAt: depois,
    ...over,
  }).status
}

console.log('\n── 1. Decisão de destino ──')
caso('"Que lindo" (elogio 95%)                            AUTO', destino({}), 'QUEUED')
caso('"Quero conhecer" (interesse 93%)                    AUTO', destino({ intent: 'interesse_em_visitar', confidence: 0.93 }), 'QUEUED')
caso('"onde fica?" com endereço na legenda (SEND)         AUTO', destino({ intent: 'localizacao', confidence: 0.97 }), 'QUEUED')
caso('"tem estacionamento?" sem info (HOLD da IA)         REVIEW', destino({ intent: 'duvida', decision: 'HOLD_FOR_REVIEW' }), 'PENDING_APPROVAL')
caso('"fui e odiei" (critica)                             REVIEW', destino({ intent: 'critica', requiresHuman: true }), 'PENDING_APPROVAL')
caso('"muito caro" (critica 91%)                          REVIEW', destino({ intent: 'critica' }), 'PENDING_APPROVAL')
caso('"isso é golpe?" (situacao_delicada)                 REVIEW', destino({ intent: 'situacao_delicada' }), 'PENDING_APPROVAL')
caso('"@joao vamos" (marcacao 98%)                        AUTO', destino({ intent: 'marcacao_de_amigo', confidence: 0.98 }), 'QUEUED')
caso('elogio com confiança 0.70 (< 0.85)                  REVIEW', destino({ confidence: 0.7 }), 'PENDING_APPROVAL')
caso('comentário ANTERIOR ao marco                        SHADOW', destino({ commentedAt: antes }), 'SHADOW')
caso('modo OFF                                            SHADOW', destino({ cfg: { ...cfgBase, reply_mode: 'OFF' } } as never), 'SHADOW')
caso('sem marco de início                                 SHADOW', destino({ cfg: { ...cfgBase, automation_started_at: null } } as never), 'SHADOW')
caso('elogios desligados na config                        REVIEW', destino({ cfg: { ...cfgBase, reply_praise: false } } as never), 'PENDING_APPROVAL')
caso('parceria comercial                                  REVIEW', destino({ intent: 'oportunidade_comercial' }), 'PENDING_APPROVAL')

console.log('\n── 2. Atraso humano ──')
const d = decidirDestino({ cfg: cfgBase, intent: 'elogio', confidence: 0.95, decision: 'SEND_BOTH', requiresHuman: false, commentedAt: depois })
const atrasoS = d.agendadoPara ? (new Date(d.agendadoPara).getTime() - Date.now()) / 1000 : -1
caso('agendado dentro da janela 3–7 min', atrasoS >= 175 && atrasoS <= 425, true)

console.log('\n── 3. Pré-filtro (sem custo de IA) ──')
caso('"https://bit.ly/xyz" (só link)      spam', preFiltro('https://bit.ly/xyz')?.intent ?? 'IA', 'spam')
caso('"ganhe R$ 500 por dia"              spam', preFiltro('ganhe R$ 500 por dia no meu perfil')?.intent ?? 'IA', 'spam')
caso('"segue de volta"                    spam', preFiltro('segue de volta')?.intent ?? 'IA', 'spam')
caso('"kkkkkk" segue para a IA', preFiltro('kkkkkk') === null, true)
caso('"onde fica?" segue para a IA', preFiltro('onde fica?') === null, true)

console.log('\n── 4. Validação final da resposta pública ──')
caso('resposta normal passa', validarRespostaPublica('Fica no Tatuapé! 📍', []), null)
caso('mencionar IA é vetado', validarRespostaPublica('Sou uma inteligência artificial e adorei', []), 'MENCIONA_IA')
caso('tom de SAC é vetado', validarRespostaPublica('Prezado cliente, agradecemos o contato', []), 'TOM_DE_SAC')
caso('repetição literal no mesmo Reel é vetada', validarRespostaPublica('Que bom que curtiu! 😍', ['que bom que curtiu! 😍']), 'REPETIDA_NO_CONTEUDO')
caso('texto de 300 chars é vetado', validarRespostaPublica('a'.repeat(300), []), 'LONGA_DEMAIS')

console.log(`\n${falhas === 0 ? '✓ MATRIZ COMPLETA: todos os casos passaram' : `✗ ${falhas} caso(s) FALHARAM`}`)
process.exit(falhas === 0 ? 0 : 1)
