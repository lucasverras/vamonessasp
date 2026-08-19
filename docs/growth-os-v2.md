# Growth OS v2 — diagnóstico e plano (19/08/2026)

Auditoria sobre o sistema em produção. Todo número foi medido hoje; onde algo
não está implementado, está escrito "FALTA", sem disfarce.

A notícia central do diagnóstico: **a spec v2 já está ~80% em produção** —
construída nas últimas 48h. Este documento separa o que já obedece a spec,
o que diverge, e o que falta.

---

## 1. Diagnóstico atual

18 migrations aplicadas (0001–0025), 20+ tabelas, RLS em todas. Pipeline em
produção: webhook (3s medidos) → análise IA (paralela, 0,8s/comentário) →
resposta pública em REVIEW → DM qualificada automática → worker com claim
atômico e revalidação no envio. Login próprio com RBAC (ADMIN/OPERADOR),
sessão assinada, rate limit de login em Postgres.

O painel já responde hoje (medido agora):

| Pergunta da spec | Resposta hoje |
|---|---|
| Quantas pessoas interagiram? | 472 interações |
| Quantas únicas? | 345 |
| Quantas NÃO seguem? | 264 comprovadas (exportação oficial) |
| Quantas seguem? | 83 comprovadas |
| Desconhecidas | 1 |
| Qualificadas para DM agora | 9 |
| Receberam DM | 197 |
| Negadas | 206, com motivo por linha |
| Públicas aguardando aprovação | 2 |

## 2. Inconsistências encontradas (e já corrigidas nesta sessão)

- Aba "Elegíveis" contava quem já estava na fila → corrigido: "elegível" =
  ainda vale mandar, 1 linha/pessoa, no banco.
- "191 recusados" sem motivo no modal → corrigido: agrupado por razão legível.
- "Na fila: 17" mentia no modo aprovação → corrigido: mostra o destino real.
- 282 DMs presas em QUEUED no modo aprovação → corrigido: campanha nasce no
  destino certo por modo.
- Aggregados da Home vazios (array lido como objeto) → corrigido.
- **Divergência ATIVA com a spec (corrigida hoje):** resposta pública estava
  automática no LIVE. Voltou a REVIEW — pública nasce PENDING_APPROVAL sempre;
  DM qualificada continua automática. Fluxos com modos independentes.

## 3. Gargalos de performance — antes × depois (TTFB, 3 medições)

| Página | Antes | Depois |
|---|---|---|
| /revisao | 2.034ms | 872ms |
| /conteudos | 1.612ms | 978ms |
| /comentarios | 1.113ms | 784ms |
| Home | 1.025ms | 917ms |

Causas: 5 awaits sequenciais em /revisao, RPC fora do Promise.all na Home, e
ZERO loading.tsx (tela congelada a cada clique). Skeleton agora pinta <100ms.
FALTA (fase 6): paginação real em listas grandes, virtualização, prefetch
explícito nos links do menu, otimistic UI na tabela de comentários.

## 4. Base JSON de seguidores — como funciona hoje

Importada ontem: **31.412 seguidores** (4 arquivos da exportação oficial
"Baixar suas informações", formatos cru/wrapper/texto — parser testado).
Cruzamento por username normalizado (lowercase, sem @) contra todos que já
interagiram: 83 viraram FOLLOWS, 264 NOT_FOLLOWING, 92 DMs pendentes de
seguidores puladas na hora. Upload em Configurações, re-importação semanal
recomendada (é snapshot). `follow_status_source = export:<data>:<quem>` e
`follow_status_checked_at` registram proveniência e idade — exatamente o
`followers_imported_at`/`source` que a spec pede.

## 5. Follow status — como funciona hoje

Camada central em [lib/instagram/follow-status.ts](../lib/instagram/follow-status.ts):

```
consultarFollowStatus(igsid) → FOLLOWS | NOT_FOLLOWING | UNKNOWN
```

Ordem de resolução (a da spec): 1º fontes soberanas (manual do Lucas,
exportação) — nunca sobrescritas pela API falha; 2º API oficial
(`is_user_follow_business`) — hoje retorna erro de Advanced Access (verificado
de novo em 18/08, erro completo documentado), então cai em 3º UNKNOWN, que
reexpira sempre: quando o App Review passar, a API assume sem mudar código.
ID estável (IGSID) é a chave primária; username só no cruzamento do JSON.

## 6. `evaluateDmEligibility` — como será

Já existe como `revalidar()` em [eligibility.ts](../lib/campaigns/eligibility.ts)
(autoridade única, chamada por prévia, servidor e worker) + `gateDmParaIgsid()`
para a sugestão. FALTA apenas o alinhamento cosmético com a spec: renomear o
retorno para `{status: QUALIFIED|REJECTED, reason}` e mapear os motivos para o
enum da Parte 16 (hoje: JA_SEGUE→ALREADY_FOLLOWING, DM_RECENTE→
RECENT_PRIVATE_REPLY, etc.). A ORDEM da spec já é a ordem do código:
própria conta → segue? → 60 dias? → Meta permite? → QUALIFIED.

## 7. Rejection reasons

Existem e são gravados por ação (206 negados hoje têm motivo). Mapa atual →
enum da spec:

| Hoje | Spec |
|---|---|
| SKIPPED_ALREADY_FOLLOWING / JA_SEGUE | ALREADY_FOLLOWING |
| DM_RECENTE / SKIPPED_RECENT_DM | RECENT_PRIVATE_REPLY |
| SKIPPED_DUPLICATE | DUPLICATE_USER |
| FORA_DA_JANELA | META_NOT_ELIGIBLE (janela de 7d) |
| FOLLOW_STATUS_UNKNOWN | FOLLOW_STATUS_UNKNOWN |
| PESSOA_NA_BLACKLIST | BLOCKED_USER |
| COMENTARIO_PROPRIO | OUR_OWN_ACCOUNT |
| SEM_IGSID | INVALID_IDENTITY |

FALTA: SENSITIVE_INTERACTION como motivo explícito de DM (hoje o HOLD segura a
DM, mas o registro não usa esse nome).

## 8. Cooldown de 60 dias

Implementado e global por pessoa: `cooldown_days_per_user = 60`, editável em
Configurações → Automação. Fonte única de `last_private_reply_at` é TRIGGER no
banco (nenhum caminho de código esquece de gravar). Testado nos 7 casos
(inclusive: DM há 5 dias → bloqueado em outro Reel; há 61 → volta).

## 9. Migrations necessárias

Nenhuma estrutural — o schema da spec existe. Fase 2 leva UMA migration
pequena: view/RPC `central_aquisicao()` unificando qualificados/enviados/
negados com o enum de motivos padronizado, + índice em
`comment_actions(skip_reason)` para a tela de Negados.

## 10. Central qualificados/enviados/negados

Hoje: qualificados = aba Elegíveis + card Oportunidades (RPC limpa);
enviados = aba Enviados; negados = misturados em SKIPPED. FALTA (fase 2): as
três telas da spec (Partes 26-28) com as colunas pedidas (origem, follow
source, última DM, template usado) e os KPIs do topo (Parte 17). A base de
dados já responde tudo — é tela.

## 11. Fila de aprovação dos comentários

Existe (/aprovacoes): sugestão persistida, OK/EDITAR/DESCARTAR, lote com
confirmação do número exato, claim atômico (duas abas = 1 envio), kill switch
soberano. Fluxo humano "Precisa de você" na Revisão com fatos
disponíveis/faltantes, resposta manual publicável e "salvar fato no conteúdo"
com confirmação. FALTA: os registros HUMAN_EDITED_AI/HUMAN/IGNORED_BY_OPERATOR
como enum formal (hoje: edited_by/reply_source/review_outcome cobrem, nomes
diferentes) e o botão [RESPONDER MANUALMENTE] na própria fila de aprovação
(hoje só na Revisão).

## 12. Menções

Webhook `mentions` assinado e ACEITO pela Meta (verificado:
`fields: ['comments','mentions']`). Ingestão pronta: tabela própria,
hidratação via endpoints oficiais mentioned_comment/mentioned_media, janela de
7d, template de DM separado e editável, toggle ON/OFF. Zero menções recebidas
ainda (aguardando a primeira real). STORY mention: chega pelo webhook de
`messages` = Advanced Access — documentado, não fingido.

## 13. Idempotência

Cinco camadas, todas testadas: dedupe_key único no webhook (5 requisições
simultâneas = 1 evento), claim por UPDATE condicional na aprovação (duas
abas = 1 envio), FOR UPDATE SKIP LOCKED no worker, unique parcial
pessoa+conteúdo no banco (23505 = decisão, não erro), e a checagem de 60 dias
em revalidar. Backoff 1→32min, rate limit da Meta pausa o lote, erro de
política (código 10) trava o kill switch sozinho.

## 14. Garantia "quem segue nunca recebe"

Três camadas: (1) gate de sugestão — FOLLOWS e UNKNOWN não geram DM;
(2) revalidar() no servidor e no worker — FOLLOWS bloqueia mesmo ação já
criada; (3) importação — marca FOLLOWS e pula DMs pendentes na hora. Fontes
manual/export são soberanas sobre a API falha. Provado hoje: 92 DMs de
seguidores puladas na importação; 12 dos 74 envios da janela LIVE (antes da
importação) eram seguidores — o custo do erro que motivou a regra atual.

## 15. Garantia dos 60 dias

Trigger no banco grava last_private_reply_at em TODO envio; revalidar bloqueia
em prévia, servidor e worker; a RPC de qualificados exclui no SQL. Teste real:
João com DM há 5 dias, comentando em outro Reel → RECENT (bloqueado).

## 16. Otimizações de performance (fase 6)

Prefetch explícito das 5 rotas principais; otimistic UI na seleção/aprovação
da tabela de comentários; paginação server-side nas abas Todos/Enviados
(hoje limit 300); virtualização se a lista passar de ~200 linhas visíveis;
`revalidatePath` seletivo no lugar de refresh amplo; medição antes/depois
como das rodadas anteriores (método já estabelecido).

## 17. Plano por fases (aguardando autorização)

| Fase | Conteúdo | Estado |
|---|---|---|
| 1 | Auditoria, eligibility, JSON, follow status | ✅ FEITA (este doc) |
| 2 | Central Aquisição: Qualificados/Enviados/Negados + enum de motivos + KPIs | ~2h de trabalho |
| 3 | Fila de aprovação: [Responder manualmente] + registros formais HUMAN/EDITED/IGNORED | ~1h |
| 4 | DM: renomear para evaluateDmEligibility + SENSITIVE_INTERACTION explícito | ~1h |
| 5 | Menções: monitorar primeira real, ajustar parsing se o payload divergir | contínuo |
| 6 | Performance: prefetch, otimistic UI, paginação | ~2h |
| 7 | Facebook: já sincronizado (185 Reels); falta coluna FB nas telas restantes | ~1h |
| 8 | TikTok: aguardando aprovação do app (fora do nosso controle) | pausado |

Home com os dois cards separados (AQUISIÇÃO × COMENTÁRIOS) entra na fase 2.
