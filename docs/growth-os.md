# Vamo Nessa Growth OS — diagnóstico, arquitetura e plano

Auditoria feita em 17/08/2026 sobre o sistema em produção. Nada foi alterado.
Todo número aqui foi medido na nossa conta real, não estimado.

Regra de leitura: onde escrevo **medido**, existe uma chamada ou query que produziu
aquele resultado nesta auditoria. Onde escrevo **não verificado**, eu não consegui
provar — e não preenchi o vazio com suposição.

---

## 1. DIAGNÓSTICO

### 1.1 Por que os agregados da Home estão vazios (B)

Não é falta de dado. É leitura errada do retorno.

`overview_media_totals` é `returns table (...)`. Via PostgREST, isso volta como
**array**: `[{views: ..., reach: ...}]`. E [overview.ts:96-99](../lib/analytics/overview.ts#L96-L99)
lê `totais?.views` — propriedade de objeto, num array. Sempre `undefined`, sempre
`?? null`, sempre `—`.

Os dados estão lá. Medido agora, últimos 30 dias:

| KPI | Valor real | Home hoje |
|---|---|---|
| Views | 2.465.191 | — |
| Alcance | 1.938.972 | — |
| Compartilhamentos | 31.928 | — |
| Comentários | 2.713 | — |

Correção é uma linha: `const t = (totais ?? [])[0]`. Não mexe em schema, sync nem RPC.

Um detalhe que quero registrar antes de corrigir: **alcance somado entre 256 Reels
não é 1,9M de pessoas**. É a soma de alcances de peças diferentes, com sobreposição
que a API não nos permite calcular. O rótulo precisa dizer isso, ou o número mente.

### 1.2 Pessoas × comentários × pares (A, item 2)

Medido nos comentários elegíveis de hoje:

| Unidade | Quantidade |
|---|---|
| Comentários elegíveis | **291** |
| Pessoas únicas | **213** |
| **Pares pessoa + conteúdo** | **238** |

Distribuição, que é o que justifica a regra nova:

| Conteúdos em que a pessoa comentou | Pessoas | Comentários |
|---|---|---|
| 1 | 197 | 222 |
| 2 | 9 | 21 |
| 3 | 5 | 27 |
| 4 | 2 | 21 |

Leitura: **16 pessoas** comentaram em mais de um Reel. A regra atual (1 DM por pessoa)
alcança 213. A regra que você quer (1 DM por pessoa + conteúdo) alcança **238** —
25 DMs a mais, todas legítimas, cada uma sobre um conteúdo diferente.

A Home hoje usa `resumo_oportunidade()`, que devolve `pessoas` (213) e rotula como
"pessoas esperando mensagem". Não é errado — é uma unidade que não corresponde ao
teto real de envio. Vou passar a guardar e exibir as três.

### 1.3 O cooldown global existe e está ligado (L)

`automation_settings.cooldown_days_per_user = 90`, aplicado em
[eligibility.ts:130-142](../lib/campaigns/eligibility.ts#L130-L142) contra
`instagram_users.last_private_reply_at`, devolvendo `COOLDOWN_DA_PESSOA`.

Isso é exatamente o bloqueio que você mandou remover. Hoje, alguém que comenta no
Santo Mar e dois dias depois no GastroMooca é barrado.

### 1.4 A constraint do banco não expressa a regra (I, J)

`comment_actions` **não tem** `instagram_user_id` nem `media_id`. A única garantia é:

```
comment_actions_one_send_per_comment_type
  unique (comment_id, action_type) where status = 'SENT'
```

Ou seja: **uma DM por comentário**. Isso está errado nos dois sentidos.

- **Permite demais:** 3 comentários no mesmo Reel são 3 `comment_id` diferentes →
  o banco aceita 3 DMs. O que impede hoje é o cooldown de 90 dias na aplicação.
  Você pediu para remover o cooldown; se removermos sem trocar a constraint, o
  sistema passa a mandar 3 DMs pelo mesmo Reel. Essa é a mudança mais perigosa
  do pacote inteiro, e é por isso que ela não pode ir sozinha.
- **Bloqueia de menos, mas na aplicação:** o cooldown barra o caso legítimo entre
  conteúdos, e barra com um `if`, não com uma garantia.

O banco não consegue expressar `USER + MEDIA` porque não guarda nem user nem media
na linha de envio. É a alteração estrutural central.

### 1.5 Resposta pública não existe (H)

A IA já **escreve** `suggested_public_reply` e ela aparece na tela de Revisão. Mas:

- não há nenhuma chamada a `POST /{comment-id}/replies` em todo o código;
- o worker não tem ramificação por `action_type` — só envia private reply.

Metade do fluxo que você descreveu está ausente do lado do envio. Não é ajuste,
é implementação.

### 1.6 Webhook (F)

O que está certo e não vou tocar: HMAC sobre o corpo cru, `401` sem gravar nada em
requisição não assinada, `webhook_events.dedupe_key` único fazendo a reentrega da
Meta colidir antes do processamento, e `200` mesmo em falha de processamento — para
a Meta não reentregar em loop.

O que muda: hoje `persistirComentarios` roda **dentro** do request
([route.ts:87-101](../app/api/webhooks/instagram/route.ts#L87-L101)). Um upsert é
rápido (3s medidos ponta a ponta). Análise de IA e chamadas à Meta, não. O request
passa a fazer só: validar → gravar → enfileirar job → `200`.

### 1.7 A IA está quase cega de contexto (G)

Contexto atual, medido em [analise.ts:153](../lib/ai/analise.ts#L153): texto do
comentário, username, legenda, `media_product_type`, `published_at`.

Não existe:

- comentários anteriores da mesma pessoa naquele conteúdo;
- respostas públicas que já demos;
- **nenhum fato estruturado** — `instagram_media` tem só `caption`. Sem endereço,
  preço, horário, nome do lugar.

Consequência direta: "Onde fica?" só é respondível quando o endereço está na legenda.
No lote que rodei hoje deu certo porque estava. Não é confiável.

E não existe reason code legível por máquina nem relatório do que faltou —
`comment_analyses` tem `decision_reason` em texto livre, `requires_human` e
`risk_level`. A fila "PRECISA DE VOCÊ" da seção 12.1 precisa de mais que isso.

### 1.8 Sem marco de início da automação (item 8)

`comments_automation_enabled` e `comments_automation_started_at` não existem.
Ligar a automação hoje varreria os 291 comentários históricos de uma vez.

### 1.9 Proteção de loop (M)

A base existe: `instagram_comments.is_from_account`, marcado comparando o autor com
`instagram_user_id` da conta, e `avaliarNaIngestao` devolve `COMENTARIO_PROPRIO`.
Nossa própria resposta pública chega como comentário nosso e cai nessa checagem.

**Não verificado:** nunca publicamos uma resposta pública, então nunca vi esse
caminho rodar de verdade. Vai ser teste explícito da fase que implementa resposta
pública, não premissa.

### 1.10 O que já está bom e eu não vou refazer

Sync idempotente, snapshots append-only, token cifrado AES-256-GCM, `server-only`
quebrando o build se segredo vazar pro cliente, RLS em 18 tabelas, `FOR UPDATE SKIP
LOCKED` na fila, classificação de erro da Meta com pausa em rate limit, kill switch,
shadow mode estrutural, 717 dias de histórico importado, envio real validado.

---

## 2. APIs — o que a plataforma entrega de fato (6, O, P, Q)

### 2.1 Facebook — medido hoje na Página Vamo Nessa SP (`362482533610739`)

| Métrica / campo | Onde | Retornou? | Observação |
|---|---|---|---|
| lista de Reels | `GET /{page}/video_reels` | ✅ **184 Reels** | 26/06/2024 → 15/08/2026 |
| `views` | objeto de vídeo | ✅ 184/184 | soma **2.633.352** |
| `post_views` | objeto de vídeo | ✅ 184/184 | **número diferente** de `views` |
| `description`, `created_time`, `permalink_url`, `length`, `thumbnails` | objeto de vídeo | ✅ | |
| `comments.summary(true).total_count` | vídeo e post | ✅ | |
| `likes.summary(true)` | objeto de vídeo | ✅ | |
| `reactions.summary(true).total_count` | **objeto de post** | ✅ | não existe no objeto de vídeo |
| `shares.count` | **objeto de post** | ⚠️ | ausente quando é zero — ver 2.2 |
| `total_video_views` e +10 métricas | `/{id}/video_insights` | ❌ | `[200] read_insights permission missing` |
| retenção / watch time | `/video_insights` | ❌ | mesmo portão |
| `/{video-id}/insights` | — | ❌ | `[100]` campo não existe; a edge é `video_insights` |
| insights da Página | `/{page}/insights` | ❓ | meus nomes de métrica deram `[100]`. **Não verificado** |

Duas coisas importam mais que a tabela:

**Um Reel do Facebook tem dois IDs.** O vídeo (`897207033046546`, de `video_reels`) e
o post (`362482533610739_122201420306380934`, de `published_posts`). As métricas estão
divididas entre eles: views no vídeo, reactions e shares no post. `platform_posts`
tem que guardar os dois, ou perdemos metade.

**As 11 métricas de insights caem todas no mesmo erro.** Não é limitação de
arquitetura — é **um escopo faltando: `read_insights`**. Nosso token tem 27 escopos
e esse não está entre eles. Resolve com re-autorização, não com App Review de
Advanced Access (a Página é sua e você é admin do app). Isso é a diferença entre
"o Facebook não dá" e "não pedimos". Sem ele já temos views, alcance por post via
reactions/comments/shares e o suficiente para a tela de Conteúdos; com ele ganhamos
retenção e watch time.

### 2.2 A decisão que preciso de você: `shares` ausente

Medido em três posts: dois voltaram **sem a chave** `shares`, um voltou `{"count": 2}`.
O Facebook omite o campo em vez de mandar zero.

Isso colide de frente com nossa regra `NULL ≠ 0`. Não consigo distinguir "zero
compartilhamentos" de "não informado" pelo corpo da resposta.

Minha proposta, e é uma escolha, não um fato: se `reactions` voltou (provando que o
objeto foi lido), tratar `shares` ausente como **0**; se o objeto todo falhou, `NULL`.
Registrar em `shares_inferred = true` para nunca esquecer que foi inferência.

### 2.3 Instagram — preservado

Nada muda. As métricas de hoje continuam: views, reach, likes, comments, shares,
saved, total_interactions, watch time médio e total, skip rate. Campos contestados
(`follows`, `reposts`) seguem nullable, com o comentário de schema explicando que a
interface nativa mostra o dado e a API não o expõe — verificado em 60 caminhos.

### 2.4 Matching Instagram ↔ Facebook — medido

256 mídias do Instagram contra 184 Reels do Facebook, similaridade Jaccard de
legenda com janela de ±72h:

| Resultado | Quantidade |
|---|---|
| Par único e forte (sim ≥ 0,60) | **163** |
| Ambíguo (mais de um candidato forte) | 7 |
| Sem candidato | 86 |

Os pares fortes são inequívocos — `sim 0,96`, `Δ 0,0h`, mesma legenda com emoji e
tudo. Os 86 sem par são coerentes: o Facebook só tem 184 Reels e começa em 06/2024,
o Instagram vai mais atrás.

Isso significa que **auto-match de alta confiança é seguro para 163 conteúdos**, e
os 7 ambíguos vão para revisão manual. Nada de auto-match abaixo do limiar.

### 2.5 TikTok — só documentação oficial, nada implementado

| Queremos | Consegue? | Como |
|---|---|---|
| lista de vídeos | ✅ | `POST /v2/video/list/` · escopo `video.list` · `max_count` 20 · cursor |
| views, likes, comentários, shares | ✅ | `POST /v2/video/query/` — campos `view_count`, `like_count`, `comment_count`, `share_count` |
| duração, título, descrição, capa, data, permalink | ✅ | `duration`, `title`, `video_description`, `cover_image_url`, `create_time`, `share_url`, `embed_link`, `height`, `width` |
| seguidores e total de likes da conta | ✅ | escopo `user.info.stats` |
| **ler comentários** | ❌ | **não existe escopo** na Display API nem na Content Posting API |
| **responder comentários** | ❌ | não existe |
| **enviar DM** | ❌ | não existe. `portability.directmessages` é exportação de dados, não mensageria |
| retenção / watch time | ❌ | não exposto |

- **OAuth:** TikTok Login Kit v2. **Escopos:** `user.info.basic`, `user.info.stats`,
  `video.list`. **Aprovação:** registro do app + aprovação de escopo + autorização
  do usuário. **Custo:** sem custo de API.
- **Research API está fora.** Ela tem `query-video-comments`, mas é para
  pesquisadores acadêmicos verificados. Usar para operar nossa conta seria uso
  indevido. Não vamos por aí.
- **Não verificado:** rate limits (as páginas que li não declaram) e se
  `video/list` devolve os contadores ou só metadados de lista — o conjunto completo
  de campos está documentado em `video/query`. Por isso o desenho é: **listar IDs
  em `video/list`, hidratar métricas em `video/query`** em lotes de 20. Funciona
  nos dois casos.

**Conclusão sobre TikTok:** entra como **fonte de analytics**, e só. Comentários e
DM no TikTok não são possíveis por API oficial hoje. A arquitetura precisa aceitar
uma plataforma sem pipeline de relacionamento em vez de assumir que toda plataforma
tem os três.

---

## 3. ARQUITETURA

### 3.1 Content + Platform Post (E)

```
CONTENT (a peça criativa · fatos editoriais)
  ├── PLATFORM_POST  instagram   → insight snapshots
  ├── PLATFORM_POST  facebook    → insight snapshots
  └── PLATFORM_POST  tiktok      → insight snapshots
```

`contents` guarda o que é da peça e da vida real: título interno, nome do lugar,
endereço, bairro, cidade, preço, horário, Instagram do local, site, observações,
tags. **Nada obrigatório.** É daqui que a IA tira fato — e só daqui.

`platform_posts` guarda uma publicação numa plataforma: `platform`,
`external_post_id`, **`external_video_id`** (o Facebook precisa dos dois),
`permalink`, `caption`, `published_at`, `media_type`, `thumbnail`, `duration`.

`platform_insight_snapshots` é append-only, uma linha por coleta, com colunas
comuns (`views`, `reach`, `likes`, `comments`, `shares`, `saved`) mais um `jsonb`
`platform_metrics` para o que é específico de cada plataforma. Nunca forço
equivalência: `post_views` do Facebook não vira `views` do Instagram.

### 3.2 Migração sem apagar nada (R, K)

Aditiva, em três passos, sem `drop` de coluna ou tabela:

1. Criar `contents`, `platform_posts`, `platform_insight_snapshots`.
2. Backfill 1:1 — um `content` por `instagram_media` existente, um `platform_post`
   `instagram` apontando para ele, com `legacy_media_id` referenciando
   `instagram_media.id`.
3. `instagram_media`, `media_insight_snapshots` e `instagram_comments.media_id`
   **ficam como estão**. Todas as FKs e RPCs atuais continuam funcionando sem
   alteração. As telas migram uma a uma, quando cada uma for reescrita.

Facebook e TikTok nascem direto no modelo novo. Zero risco para o histórico.

---

## 4. AUTOMAÇÃO — fluxo completo

```
COMENTÁRIO NOVO
      ↓
webhook: HMAC → dedupe → grava comentário → cria job → 200        (nada mais aqui)
      ↓
ANALYZE_COMMENT   carrega contexto · classifica · decide
      ↓
   ┌──────────────── a IA consegue responder com segurança? ────────────────┐
   ↓ SIM                                                                ↓ NÃO
GENERATE + SEND_PUBLIC_REPLY                              NEEDS_HUMAN_REVIEW
   ↓                                                          ↓
CHECK_PRIVATE_REPLY  (pessoa + conteúdo)                  fila PRECISA DE VOCÊ
   ↓                                                          ↓
SEND_PRIVATE_REPLY se elegível                            você responde no painel
   ↓                                                          ↓
registra resultado                                        sistema publica
                                                              ↓
                                                          você decide a DM
                                                              ↓
                                                          HUMAN_REPLIED
```

### 4.1 O fallback humano é o caminho principal, não a exceção (12.1)

A IA passa a devolver, além da classificação:

- `decision`: `AUTO_REPLY` · `NEEDS_HUMAN_REVIEW` · `IGNORE`
- `decision_reason_code`: enum — `PRICE_NOT_AVAILABLE`, `ADDRESS_NOT_AVAILABLE`,
  `HOURS_NOT_AVAILABLE`, `MISSING_INFORMATION`, `AMBIGUOUS_QUESTION`,
  `POSSIBLY_OUTDATED`, `COMPLAINT`, `SENSITIVE`, `LOW_CONFIDENCE`, `OUR_OWN_ACCOUNT`, `SPAM`
- `facts_available` / `facts_missing`: listas do que tinha e do que faltou
- `missing_field`: o campo exato, quando dá para nomear (`parking`, `price_sunday`)

E a regra que fecha o buraco que você apontou: **quando falta fato, a decisão é
`NEEDS_HUMAN_REVIEW`, não uma resposta genérica.** "Consulte o estabelecimento" só
é permitido quando a própria pergunta não tem resposta objetiva — nunca para esvaziar
fila. Vou escrever isso no prompt com exemplo do certo e do errado, como já fiz com
o CTA, porque é assim que a regra pega.

**Confiança não decide sozinha.** O gate é composto: existe fato suficiente? a
pergunta foi entendida? há risco de informação vencida? há sensibilidade? há
ambiguidade? Qualquer "não" manda para você, independente do número.

### 4.2 Private reply segue a resposta pública, nunca a atropela

Se caiu em `NEEDS_HUMAN_REVIEW`, **a DM também espera**. Uma reclamação não pode
receber "Valeu por comentar, segue a gente 💚" — e hoje o sistema não tem nada que
impeça isso além do shadow mode.

Quando você responde no painel, aparece `☑ Enviar também Private Reply`, marcado por
padrão **exceto** em `COMPLAINT`, `ABUSE`, `SENSITIVE`, `SPAM`.

### 4.3 Aprender com você, sem inventar

Depois que você responde à mão, o sistema oferece
`[ SALVAR COMO INFORMAÇÃO DO CONTEÚDO ]`. Só com sua confirmação sua frase vira
fato reutilizável em `contents`. Sem confirmação, fica só como resposta daquele
comentário. Nunca promoção automática de resposta a fato.

### 4.4 Jobs, retry, rate limit (N)

Jobs separados com `status`, `attempts`, `scheduled_at`, `started_at`,
`completed_at`, `error_code`, `error_message`, `meta_response`, `ai_output`:
`ANALYZE_COMMENT`, `GENERATE_PUBLIC_REPLY`, `SEND_PUBLIC_REPLY`,
`CHECK_PRIVATE_REPLY`, `SEND_PRIVATE_REPLY`.

Rate limit reaproveita o que já existe e já provou: `MetaError` classifica
`RATE_LIMIT` e o worker **para** em vez de insistir — insistir estende o bloqueio.
Backoff exponencial, e a idempotência vem de constraint, não de `if`.

### 4.5 Modos e o marco de início

`OFF` · `REVIEW` · `AUTO`, trocável sem redeploy.

`comments_automation_started_at` grava o instante do "ligar". **Só comentário com
`commented_at` posterior entra no pipeline automático.** Os 291 históricos continuam
disponíveis para operação manual. Sem isso, ligar a automação dispara uma avalanche.

---

## 5. DEDUPLICAÇÃO — a garantia, e a prova

### 5.1 As duas constraints

```sql
-- passo 1: a linha de envio passa a saber de quem e de qual conteúdo
alter table comment_actions
  add column instagram_user_id text,
  add column media_id uuid references instagram_media(id) on delete cascade;

update comment_actions a
   set instagram_user_id = c.instagram_user_id, media_id = c.media_id
  from instagram_comments c
 where c.id = a.comment_id;

-- passo 2: UMA DM POR PESSOA POR CONTEÚDO
create unique index comment_actions_uma_dm_por_pessoa_conteudo
on comment_actions (instagram_user_id, media_id)
where action_type = 'PRIVATE_REPLY'
  and status in ('PENDING_APPROVAL','APPROVED','QUEUED','SENDING','SENT');

-- passo 3: UMA RESPOSTA PÚBLICA POR COMENTÁRIO (dedupe por comment_id, não por pessoa)
create unique index comment_actions_uma_publica_por_comentario
on comment_actions (comment_id)
where action_type = 'PUBLIC_REPLY'
  and status in ('PENDING_APPROVAL','APPROVED','QUEUED','SENDING','SENT');
```

O ponto que faz isso ser garantia e não checagem: **o `INSERT` é a reserva**. Os
status pendentes estão dentro do predicado, então dois webhooks simultâneos, dois
workers, um retry e uma reentrega da Meta disputam a mesma linha — o segundo recebe
`23505` e vira `SKIPPED_DUPLICATE_USER_MEDIA`, que **não é erro**. Nenhum `if`
participa da garantia.

`FAILED` fica fora do predicado de propósito: uma falha permanente libera o slot
para nova tentativa depois.

### 5.2 A prova pedida

**João comenta 3× no Reel Santo Mar**

| # | Comentário | Resposta pública | Private reply | Por quê |
|---|---|---|---|---|
| 1 | "Onde fica?" | ✓ enviada | ✓ enviada | primeiro par João+SantoMar |
| 2 | "Abre domingo?" | ✓ enviada | ○ ignorada | `SKIPPED_DUPLICATE_USER_MEDIA` |
| 3 | "Vou nesse fds" | ✓ enviada | ○ ignorada | `SKIPPED_DUPLICATE_USER_MEDIA` |

→ **3 respostas públicas, 1 DM.**

**João comenta 1× no Santo Mar e 1× no GastroMooca** (2h depois)

| Conteúdo | Resposta pública | Private reply | Por quê |
|---|---|---|---|
| Santo Mar | ✓ | ✓ | par João+SantoMar |
| GastroMooca | ✓ | ✓ | **outro par** — `(user, media)` diferente |

→ **2 respostas públicas, 2 DMs.** Duas DMs no mesmo dia, intencional.

**O exemplo definitivo:** 3× Santo Mar + 2× GastroMooca = 5 comentários →
**até 5 respostas públicas, exatamente 2 DMs.**

### 5.3 Identidade (17)

Dedupe por `instagram_user_id` (IGSID), que é estável. `username` só aparece na tela.
Comentário sem IGSID nunca entra na fila de DM — `SEM_IGSID` já existe e continua.

### 5.4 O que sai

`cooldown_days_per_user` e `COOLDOWN_DA_PESSOA` saem da elegibilidade. A coluna
`instagram_users.last_private_reply_at` **fica**, como informação de operação — ela
deixa de bloquear. A blacklist por pessoa continua: é decisão sua, não cooldown.

### 5.5 Status (19)

`PENDING` · `ELIGIBLE` · `SENT` · `SKIPPED_DUPLICATE_USER_MEDIA` · `NOT_ELIGIBLE` ·
`EXPIRED` · `FAILED` · `ALREADY_FOLLOWING`.

`ALREADY_FOLLOWING` **só** quando a Meta permitir verificar oficialmente. Não
consegui verificar isso nesta auditoria e não vou inventar o status — a frase "se
ainda não segue" resolve sem precisar dele.

---

## 6. BANCO — migrations (K)

| # | Migration | O que faz | Risco |
|---|---|---|---|
| 0014 | `home_agregados` | corrige a leitura do array; RPC com as 3 unidades (comentários, pessoas, pares) | nenhum — leitura |
| 0015 | `dm_por_pessoa_conteudo` | colunas + backfill + as 2 constraints; remove o cooldown global | **alto** — muda quem pode receber |
| 0016 | `automacao_marco` | `comments_automation_enabled/started_at`, `mode` OFF/REVIEW/AUTO | baixo |
| 0017 | `ia_fallback_humano` | `decision_reason_code`, `facts_available/missing`, `missing_field`, `reply_source`, `responded_by/at` | baixo — aditivo |
| 0018 | `jobs` | tabela de jobs com os 5 tipos, tentativas e backoff | baixo |
| 0019 | `contents_platform_posts` | as 3 tabelas novas + backfill 1:1 do Instagram | médio — só aditivo |
| 0020 | `facebook` | sync da Página nas tabelas novas | baixo |
| 0021 | `matching` | `match_confidence`, `match_method`, `matched_by`, revisão manual | baixo |
| 0022 | `contents_editorial` | endereço, preço, horário, bairro, site, observações | baixo |
| 0023 | `tiktok` | apenas se você aprovar depois de ler a seção 2.5 | — |

Nenhuma faz `drop`. Nenhuma toca em `account_snapshots` ou
`account_daily_insights` — os 717 dias ficam intactos.

---

## 7. PLANO — fases pequenas, cada uma verificável

| Fase | O que entra | Como sei que funcionou | Reversível? |
|---|---|---|---|
| **0** | 1 linha: agregados da Home | os 4 KPIs mostram 2.465.191 / 1.938.972 / 31.928 / 2.713 | sim |
| **1** | 3 unidades de contagem em toda tela | Home diz 291 comentários · 213 pessoas · **238 pares** | sim |
| **2** | `read_insights` + sync do Facebook | 184 Reels no banco, 2.633.352 views, retenção se o escopo passar | sim |
| **3** | `contents` + `platform_posts` + backfill | 256 conteúdos migrados, telas antigas intactas | sim |
| **4** | Matching IG↔FB + revisão manual | 163 auto-vinculados, 7 na fila, 0 vínculos fracos automáticos | sim |
| **5** | Tela Conteúdos multiplataforma | Santo Mar mostra IG + FB + total, com tooltip de soma | sim |
| **6** | Jobs + webhook enfileirando | webhook responde sem esperar IA; job registra cada etapa | sim |
| **7** | Contexto rico + fallback humano + fila PRECISA DE VOCÊ | comentário sem fato vira `NEEDS_HUMAN_REVIEW` com o campo que faltou nomeado | sim |
| **8** | **Resposta pública real** — `POST /{comment-id}/replies` | 1 resposta num comentário de teste controlado nosso, e o loop **não** dispara | sim |
| **9** | **1 DM por pessoa + conteúdo** — migration 0015 | teste com 3 comentários no mesmo Reel: 3 públicas, 1 DM; e o `INSERT` duplicado recusado pelo banco | **não** — precisa da sua autorização explícita |
| **10** | Modos OFF/REVIEW/AUTO + marco de início | ligar em REVIEW não move nenhum dos 291 históricos | sim |
| **11** | Central operacional + funil + antes/depois | taxa de automação real, sem otimizar o número | sim |
| **12** | TikTok | só depois de você ler 2.5 e aprovar | sim |

Ordem que sugiro para começar: **0 → 1 → 2 → 6 → 7 → 8 → 9**. Fases 3–5 (modelo
multiplataforma e telas) são as maiores e não bloqueiam a automação; fase 9 é a
única irreversível e vem depois da 8, porque remover o cooldown antes de existir
resposta pública e constraint nova é justamente a combinação que manda 3 DMs pelo
mesmo Reel.

---

## Regras que respeitei nesta auditoria

Nenhum scraping, nenhum login automatizado, nenhum endpoint privado. Só leitura na
Graph API. Nenhuma mensagem enviada, kill switch ainda travado, shadow mode ligado.
Vínculo Facebook↔Instagram não tocado, Business Portfolio não tocado, Página não
trocada, autenticação não migrada. Nenhum dado apagado. Os 238 pares seguem intactos.

Onde a API respondeu `200` sem o campo pedido, registrei como indisponível — não
como sucesso.
