# Painel Vamo Nessa — Plano Técnico

> Documento de decisão. Nada foi implementado ainda.
> Data da pesquisa da documentação Meta: 17/08/2026. Graph API atual: **v26.0** (lançada 29/07/2026).

Objetivo único do produto: **aumentar seguidores do @vamonessasp**, por dois caminhos:

1. `DADOS → entendimento do crescimento → melhores decisões de publicação`
2. `INTERAÇÃO → OPORTUNIDADE → PRIVATE REPLY → mais chance de follow`

---

## 1. Diagnóstico do projeto atual

| Item | Situação |
|---|---|
| `/Users/lucaslucas/Desktop/vmnessa` | **Vazia.** Zero arquivos, não é repositório git. |
| Stack existente | Nenhuma. Greenfield total. |
| Node / npm | v25.9.0 / 11.12.1 (pnpm 11.1.2 disponível) |
| Projeto irmão (`~/Desktop/gbc`) | Next.js 16.2.10, React 19.2.4, TypeScript 5, Tailwind v4 (`@tailwindcss/postcss`), ESLint 9, framer-motion, lucide-react, Vercel. Sem Supabase, sem shadcn/ui. |
| Skills instaladas | `impeccable`, `design-for-ai`, `ui-ux-layout-advisor`, `ui-ux-pro-max`, `dataviz`, `motion-framer`, `frontend-slides`, `code-review`, `security-review`, `claude-mem:*` |

**Conclusões:**

- Não há código legado para respeitar → a stack preferida do briefing é adotada integralmente, sem concessões.
- O `gbc` estabelece convenções que vale herdar (Next App Router, TS estrito, Tailwind v4, deploy Vercel). Vou seguir as mesmas versões maiores para você não manter dois mundos diferentes.
- Skills relevantes já disponíveis: **`impeccable`** (revisão UI/UX no fim de cada fase), **`dataviz`** (sistema de gráficos — usar antes de escrever o primeiro Recharts), **`security-review`** e **`code-review`** (gates de qualidade).

---

## 2. Arquitetura proposta

### 2.1 Stack

| Camada | Escolha | Motivo |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript strict | Server Components + Route Handlers = toda chamada Meta fica no servidor por construção |
| UI | Tailwind CSS v4 + shadcn/ui + lucide-react | Densidade de SaaS sem CSS artesanal |
| Gráficos | Recharts | Pedido; suficiente para linha + barra + heatmap |
| Motion | framer-motion (`motion`) | Micro-interações discretas (skill `motion-framer` disponível) |
| Banco | Supabase Postgres | Migrations + RLS + tipos gerados + `pg_cron`/`pg_net` no free tier |
| Auth do painel | Supabase Auth (magic link) + allowlist de e-mails | Ferramenta interna, sem senha compartilhada |
| Fila | **Postgres como fila** (`FOR UPDATE SKIP LOCKED`) | Zero serviço extra, zero custo |
| Agendador | **`pg_cron` + `pg_net` no Supabase** chamando nossos endpoints, + Vercel Cron como heartbeat diário | Granularidade de minuto de graça (ver §9) |
| Deploy | Vercel | Pedido |

### 2.2 Regra de ouro da arquitetura

```
                      NUNCA
        ┌──────────────╳──────────────┐
        │                             │
   [ Frontend ] ──✕──────────────> [ Meta API ]
```

```
   [ Meta API ]
        │  (server-only: fetch com token descriptografado em memória)
        ▼
   [ Next.js Route Handlers / Server Actions ]   ← única camada que fala com a Meta
        │
        ▼
   [ Supabase Postgres ]   ← única fonte de verdade do frontend
        │
        ▼
   [ Server Components / RSC ]  →  [ Client Components (só interação) ]
```

O frontend **nunca** conhece `META_APP_SECRET`, `ACCESS_TOKEN` ou `SERVICE_ROLE_KEY`. As métricas agregadas (medianas por horário, crescimento pós-post, funil) são calculadas em SQL/servidor, nunca no browser.

### 2.3 Estrutura de pastas

```
app/
  (auth)/login/
  (app)/
    layout.tsx                 # sidebar + shell
    page.tsx                   # Visão Geral
    hoje/page.tsx              # Hoje
    conteudos/page.tsx
    conteudos/[mediaId]/page.tsx
    crescimento/page.tsx
    comentarios/page.tsx
    campanhas/page.tsx
    campanhas/[id]/page.tsx
    horarios/page.tsx
    frequencia/page.tsx
    configuracoes/instagram/page.tsx
    configuracoes/mensagens/page.tsx
  api/
    auth/instagram/start/route.ts       # redirect p/ OAuth
    auth/instagram/callback/route.ts    # troca code → token longo
    webhooks/instagram/route.ts         # GET handshake + POST assinado
    cron/snapshot-account/route.ts      # horário
    cron/sync-media/route.ts            # escalonado
    cron/sync-comments/route.ts         # reconciliação
    cron/refresh-token/route.ts         # semanal
    cron/dm-worker/route.ts             # a cada minuto
    campaigns/[id]/kick/route.ts        # dispara worker sem esperar o cron
lib/
  instagram/
    meta-client.ts        # fetch tipado, versão da API, parsing de erro, headers de uso
    auth.ts               # OAuth, token longo, refresh, cripto do token
    account.ts            # perfil + insights de conta
    media.ts              # listagem paginada
    insights.ts           # insights de mídia (mapeia métrica → NULL vs 0)
    comments.ts
    private-replies.ts    # POST /{ig-id}/messages  recipient:{comment_id}
    webhooks.ts           # verificação HMAC + normalização de payload
    errors.ts             # classifica permanente | temporário | token | rate-limit
    sync.ts               # orquestra sync_runs
  analytics/
    growth.ts             # crescimento líquido, médias, vs período anterior
    post-growth.ts        # +1h/+3h/+6h/+24h/+48h/+7d após publicação
    frequency.ts
    timing.ts             # medianas dia × hora
    statistics.ts         # mediana, N, faixa de confiança
    funnel.ts             # comentários → elegíveis → enviados → respostas
  campaigns/
    eligibility.ts        # REGRA ÚNICA de elegibilidade (usada na UI e no worker)
    queue.ts              # claim/release, backoff, idempotência
    worker.ts             # processa lote respeitando rate limit
  db/
    client.ts             # service-role (server-only) e anon (RSC autenticado)
    types.ts              # gerado do Supabase
supabase/
  migrations/*.sql
docs/
  plano-tecnico.md · architecture.md · meta-instagram-setup.md · private-replies.md
```

Regra: nenhum componente React importa de `lib/instagram/`. Só rotas de API, server actions e cron jobs.

---

## 3. Fluxo Instagram → Webhook → Supabase

```
 Alguém comenta no Reel
          │
          ▼
 Meta envia POST  →  /api/webhooks/instagram
          │
          ├─ 1. lê o corpo CRU (req.text())
          ├─ 2. calcula HMAC-SHA256(raw, META_APP_SECRET)
          ├─ 3. compara com X-Hub-Signature-256 (timingSafeEqual)
          │      ✕ divergente → 401, nada é gravado
          ├─ 4. grava evento cru em webhook_events (dedupe por hash)
          ├─ 5. UPSERT em instagram_comments
          │      ON CONFLICT (instagram_comment_id) DO NOTHING
          ├─ 6. calcula eligibility_status + eligibility_expires_at
          └─ 7. responde 200 em < 1s  (Meta reentrega se demorar/falhar)
                     │
                     ▼
              Supabase Realtime / revalidate
                     │
                     ▼
              Dashboard atualiza
```

**Reconciliação (eventos perdidos):** webhook não é garantia de entrega, e enquanto o app estiver em modo Development a Meta **não envia webhooks**. Então existe também `cron/sync-comments` (a cada 15 min): varre as mídias publicadas nos últimos 8 dias via `GET /{media-id}/comments` e faz upsert. Como o upsert é idempotente, webhook e polling convivem sem duplicar. Polling agressivo é evitado limitando a janela a 8 dias (a janela de private reply é 7).

**Handshake de verificação:** `GET` com `hub.mode=subscribe`, `hub.verify_token` comparado com `META_WEBHOOK_VERIFY_TOKEN`, resposta = `hub.challenge` em texto puro.

---

## 4. Fluxo Comentário → Elegibilidade → Campanha → Private Reply

```
 instagram_comments (ELIGIBLE)
          │
          ▼  você seleciona na tela Comentários (ou "selecionar todos elegíveis")
          │
          ▼  modal: mensagem editável + contagem
 [ Enviar para 187 ]
          │
          ▼  server action (transação)
   ┌──────────────────────────────────────────────┐
   │ cria dm_campaigns (status=QUEUED)            │
   │   message_snapshot = texto EXATO usado       │
   │ cria dm_campaign_recipients (status=PENDING) │
   │   UNIQUE (campaign_id, comment_id)           │
   │   UNIQUE parcial global: 1 reply por comment │
   └──────────────────────────────────────────────┘
          │
          ├─ dispara /api/campaigns/[id]/kick (não espera o cron)
          ▼
 WORKER (cron 1×/min + kick)
   ┌────────────────────────────────────────────────────────────────┐
   │ orçamento do tick = min(lote, 750/h − enviados na última hora) │
   │ claim: SELECT … FOR UPDATE SKIP LOCKED LIMIT n                 │
   │        SET locked_until = now() + 2min                         │
   │                                                                │
   │ ► REVALIDAÇÃO OBRIGATÓRIA no backend, por destinatário:        │
   │     1. comentário ainda existe e não está deletado?            │
   │     2. now() < commented_at + JANELA_PRIVATE_REPLY (7d)?       │
   │     3. já existe private_reply_sent_at p/ esse comment_id?     │
   │     4. já mandamos DM p/ esse instagram_user_id? (anti-spam)   │
   │     5. token válido e com escopo de mensagens?                 │
   │   qualquer NÃO → SKIPPED / EXPIRED, sem chamar a Meta          │
   │                                                                │
   │ POST graph.instagram.com/v26.0/{ig-id}/messages                │
   │   { recipient:{ comment_id }, message:{ text } }               │
   │                                                                │
   │ ► classifica a resposta:                                       │
   │     200      → SENT   (grava message_id + sent_at)             │
   │     permanente → FAILED (sem retry): fora da janela, já        │
   │                  respondido, comentário deletado, privacidade  │
   │     temporário → PENDING + attempts++ + backoff exponencial    │
   │                  (rate limit 80002, 5xx, rede)                 │
   │     token (190) → PAUSA a campanha + alerta em Configurações   │
   └────────────────────────────────────────────────────────────────┘
          │
          ▼
 dashboard de progresso (Supabase Realtime)
```

**O frontend nunca é autoridade.** A seleção da UI é só uma intenção; a decisão de enviar é tomada no worker, no instante do envio, contra o banco.

---

## 5. Tabelas do banco

Timezone canônico: **America/Sao_Paulo**. Tudo é gravado em `timestamptz` (UTC) e derivado para SP na escrita das colunas de recorte (`published_weekday`, `published_hour`) e na leitura via `AT TIME ZONE 'America/Sao_Paulo'`.

**Convenção `NULL` vs `0` (crítica):** toda coluna de métrica é `nullable`. `NULL` = a Meta não forneceu a métrica (não suportada, em desenvolvimento, erro parcial). `0` = a Meta forneceu zero. Cada snapshot guarda também `raw jsonb` (resposta bruta) e `metrics_unavailable text[]` para auditoria.

```
instagram_accounts
  id uuid pk · instagram_user_id text unique · username · name
  profile_picture_url · followers_count int · media_count int · account_type
  access_token_encrypted bytea      -- AES-256-GCM, nunca em texto puro
  token_expires_at timestamptz · scopes text[] · connection_status
  last_sync_at · last_error_code · last_error_message · last_error_at
  created_at · updated_at

account_snapshots                    -- coração do "estamos crescendo?"
  id · instagram_account_id fk · followers_count · media_count
  reach_day int null · views_day int null · total_interactions_day int null
  source text ('cron_hourly' | 'oauth_connect' | 'manual' | 'meta_backfill')
  captured_at timestamptz
  UNIQUE (instagram_account_id, captured_at)

account_daily_insights               -- backfill via métrica follower_count (dia)
  id · instagram_account_id fk · date date · follows int null · unfollows int null
  reach null · views null · total_interactions null · raw jsonb
  UNIQUE (instagram_account_id, date)

instagram_media
  id uuid pk · instagram_media_id text unique · instagram_account_id fk
  media_type · media_product_type · caption · permalink
  thumbnail_url · media_url · shortcode · thumbnail_cached_path   -- URLs da Meta EXPIRAM
  published_at timestamptz · published_weekday smallint · published_hour smallint
  is_shared_to_feed bool · deleted_at timestamptz null
  created_at · updated_at

media_insight_snapshots
  id · media_id fk · views null · reach null · likes null · comments null
  shares null · saved null · reposts null · total_interactions null
  avg_watch_time_ms null · total_watch_time_ms null · reels_skip_rate null
  follows null · profile_visits null            -- só FEED/STORY (ver §8)
  raw jsonb · metrics_unavailable text[] · captured_at timestamptz
  UNIQUE (media_id, captured_at)

instagram_comments
  id uuid pk · instagram_comment_id text UNIQUE   ← idempotência
  instagram_media_id text fk→instagram_media.instagram_media_id
  instagram_user_id text null · username text null · text text
  parent_comment_id text null · is_from_account bool
  commented_at timestamptz · received_at timestamptz
  source text ('webhook' | 'sync')
  eligibility_status text        -- ELIGIBLE|SENT|FAILED|EXPIRED|NOT_ELIGIBLE
  eligibility_expires_at timestamptz     -- commented_at + janela oficial
  not_eligible_reason text null
  private_reply_sent_at · private_reply_message_id · failure_reason
  deleted_at null · created_at · updated_at

dm_templates
  id · name · body · status (ACTIVE|ARCHIVED) · created_at · updated_at

dm_campaigns
  id · name · status (DRAFT|QUEUED|RUNNING|PAUSED|COMPLETED|FAILED)
  message_snapshot text          -- NUNCA muda depois de executada
  template_id fk null · is_ab_test bool
  total_recipients · sent_count · failed_count · skipped_count
  created_at · started_at · completed_at · created_by

dm_campaign_variants           -- estrutura pronta p/ A/B (§16)
  id · campaign_id fk · label ('A'|'B'|…) · message_snapshot · weight int

dm_campaign_recipients
  id · campaign_id fk · comment_id fk · variant_id fk null
  status (PENDING|SENDING|SENT|FAILED|SKIPPED)
  attempts int default 0 · next_attempt_at · locked_until · locked_by
  sent_at · ig_message_id · ig_recipient_id
  error_code · error_message · error_class (PERMANENT|TEMPORARY|TOKEN)
  created_at · updated_at
  UNIQUE (campaign_id, comment_id)
  + índice único global garantindo 1 private reply enviada por comment_id

dm_replies_received            -- fase 5, via webhook `messages`
  id · instagram_user_id · comment_id null · text · received_at

webhook_events
  id · object · field · payload jsonb · signature_valid bool
  dedupe_key text unique · processed_at · error · received_at

sync_runs
  id · type · started_at · completed_at · status
  records_processed int · api_requests int · error_code · error_message

app_users                     -- allowlist de acesso ao painel
  id · email unique · role · created_at
```

**Índices:** `instagram_media(published_at desc)`, `instagram_media(instagram_account_id, published_at)`, `instagram_comments(commented_at desc)`, `instagram_comments(eligibility_status, eligibility_expires_at)`, `instagram_comments(instagram_media_id)`, `instagram_comments(instagram_user_id)`, `media_insight_snapshots(media_id, captured_at desc)`, `account_snapshots(instagram_account_id, captured_at desc)`, `dm_campaign_recipients(campaign_id, status)`, `dm_campaign_recipients(status, next_attempt_at)` (índice da fila).

**RLS:** habilitada em todas as tabelas. `anon` → nega tudo. `authenticated` presente em `app_users` → `SELECT` apenas. Nenhuma escrita pelo cliente; toda mutação passa por Route Handler/Server Action com service role. `instagram_accounts.access_token_encrypted` fica fora de qualquer view exposta.

---

## 6. Permissões Meta necessárias

Decisão: **Instagram API with Instagram Login** (host `graph.instagram.com`), não Facebook Login.

Por quê: uma única conta, sem dependência de Página do Facebook nem Business Manager, menos permissões, OAuth mais simples. Custo: token longo de **60 dias** (renovável) em vez de token de Página perpétuo, e as métricas agregadas `total_views`/`total_likes`/`total_comments` (que incluem Facebook e impulsionamento) só existem no Facebook Login. Para o objetivo — crescimento orgânico do @vamonessasp — isso não é perda relevante. O `meta-client.ts` abstrai host + auth, então migrar para Facebook Login depois é contido a um arquivo.

| Permissão | Para quê | Observação |
|---|---|---|
| `instagram_business_basic` | perfil, `followers_count`, `media_count`, listar mídias | obrigatória; também é requisito para refresh do token |
| `instagram_business_manage_insights` | insights de conta e de mídia | confirmar disponibilidade no App Dashboard (ver §8) |
| `instagram_business_manage_comments` | ler comentários + **enviar private reply** | a doc oficial de Private Replies exige esta + basic |
| `instagram_business_manage_messages` | continuar conversa / receber webhook `messages` (fase 5) | necessária p/ medir "respostas recebidas" |

Não pediremos `instagram_business_content_publish` (fora de escopo — sem publicação automática).

**Requisitos operacionais além do OAuth:**

1. Conta `@vamonessasp` deve ser **Professional** (Business ou Creator).
2. No app do Instagram: **Configurações → Privacidade → Mensagens → Ferramentas conectadas → "Permitir acesso a mensagens" LIGADO**. Sem isso, o endpoint de mensagens falha mesmo com permissão concedida.
3. **O app precisa estar em modo Live** para a Meta entregar webhooks. Em Development, tudo o mais funciona para contas com papel de tester — por isso a reconciliação por polling existe desde a fase 1, e a fase 3 é testável antes da revisão.
4. **App Review + Advanced Access** para as permissões de comentários/mensagens (e provavelmente verificação de negócio). Este é o item de maior risco de prazo — deve ser submetido cedo, em paralelo às fases 1–2.

---

## 7. Endpoints oficiais que serão usados

Todos em `https://graph.instagram.com/v26.0` (exceto o OAuth).

| Uso | Chamada |
|---|---|
| Autorizar | `GET https://www.instagram.com/oauth/authorize` (`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`) |
| Code → token curto | `POST https://api.instagram.com/oauth/access_token` |
| Token curto → longo (60d) | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token` |
| Renovar token | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` |
| Perfil | `GET /me?fields=user_id,username,name,profile_picture_url,followers_count,media_count,account_type` |
| Mídias (paginado) | `GET /me/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count,is_shared_to_feed,alt_text&limit=50` |
| Insights de mídia | `GET /{media-id}/insights?metric=…` |
| Insights de conta | `GET /{ig-id}/insights?metric=…&period=day&metric_type=total_value` |
| Comentários | `GET /{media-id}/comments?fields=id,text,timestamp,username,from,parent_id,like_count` |
| Assinar webhooks | `POST /{ig-id}/subscribed_apps?subscribed_fields=comments,messages` |
| **Private reply** | `POST /{ig-id}/messages` → `{"recipient":{"comment_id":"<ID>"},"message":{"text":"…"}}` |

Métricas de mídia por tipo (conforme referência oficial):

- **REELS:** `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `reposts`, `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`
- **FEED (foto/carrossel):** `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `reposts`, `total_interactions`, `follows`, `profile_visits`, `profile_activity`
- **STORY:** `views`, `reach`, `replies`, `navigation`, `shares`, `follows`, `profile_visits` — fora do MVP (expira em 24h)

Métricas de conta: `reach`, `views`, `likes`, `comments`, `shares`, `saves`, `total_interactions`, `accounts_engaged`, `follows_and_unfollows` (breakdown `follow_type`), `follower_count`, `follower_demographics` (lifetime).

---

## 8. Limitações atuais da API — classificação honesta

### ✅ CONFIRMADO PELA API

- OAuth Instagram Business Login; token longo de 60 dias, renovável após 24h de idade; expira definitivamente se não renovado em 60 dias.
- Perfil com `followers_count` e `media_count` (estado atual).
- Listagem paginada de todas as mídias com `media_product_type`, `permalink`, `timestamp`, `like_count`, `comments_count`.
- Insights de mídia: `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `reposts`, `total_interactions`; para Reels também `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`.
- Insights de conta diários, incluindo `follows_and_unfollows` com breakdown `follow_type`.
- Webhook `comments` com verificação `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com o app secret).
- **Private reply:** `POST /{ig-id}/messages` com `recipient:{comment_id}` — **7 dias contados da criação do comentário**, **um único envio por comentário, para sempre**.
- Rate limits: plataforma Instagram `4800 × impressões` por 24h; **Private Replies: 750 chamadas/hora** para comentários de posts e reels (100/s em Live).
- Erro `80002` = rate limit da plataforma Instagram → pausar, não insistir (insistir estende o bloqueio).

### ⚠️ POSSÍVEL COM LIMITAÇÃO

- **`follows` por conteúdo existe apenas para FEED e STORY, NÃO para REELS.** Como o Vamo Nessa cresce por Reels, na prática **não há atribuição oficial de seguidores por conteúdo**. Isso valida a decisão do briefing: o card se chama *"Crescimento da conta após a publicação"*, nunca "seguidores gerados pelo Reel". Para posts de feed, mostraremos `follows` oficial rotulado como métrica da Meta.
- `views`, `total_interactions`, `ig_reels_video_view_total_time`, `reels_skip_rate` estão marcados na doc como **"in development"** → podem vir ausentes ou dar erro parcial. Tratamento: `NULL` + registro em `metrics_unavailable`, nunca `0`.
- `saved_count` e `shares_count` no objeto de mídia são campos **não-públicos** (podem exigir permissão extra) → usaremos os equivalentes via `/insights`.
- Insights podem não existir para mídias publicadas antes de a conta se tornar Professional, e para mídias muito antigas.
- Histórico da Meta é curto: `follower_count` por dia cobre uma janela limitada (~30 dias por consulta) e exige 100+ seguidores (temos ~28k, OK). **Por isso nosso `account_snapshots` horário é a fonte de verdade** — quanto mais tempo rodando, melhor fica, e isso não é recuperável depois.
- `thumbnail_url` / `media_url` da Meta **expiram**. Precisamos recarregar no sync e/ou cachear thumbnails no Supabase Storage.
- IGSID do comentarista depende de a conta ter "Permitir acesso a mensagens" ligado; e a privacidade do usuário pode bloquear solicitações de mensagem → private reply falha legitimamente.
- `total_views`/`total_likes`/`total_comments` (agregados com Facebook e impulsionamento): **só via Facebook Login**.
- "Respostas recebidas" (§29) é mensurável, mas só com `instagram_business_manage_messages` + webhook `messages`, e a conversa só continua dentro da janela de 24h após a resposta da pessoa.

### ❌ NÃO DISPONÍVEL

- **Atribuição individual "esta DM gerou este seguidor".** Nenhum endpoint liga um seguidor a um comentário ou a uma mensagem. Consequência de produto: a etapa `DM → FOLLOW` **não será criada** no funil; mostraremos as duas séries lado a lado com rótulo de associação temporal.
- Lista de seguidores, lista de quem deixou de seguir, ou verificar se um usuário específico segue a conta.
- Mais de um private reply por comentário; private reply depois de 7 dias.
- DM para quem não comentou nem escreveu (não existe cold DM oficial).
- Métricas descontinuadas: `impressions` (removida em 21/04/2025), `video_views`, `plays`, `profile_views`.
- Scraping, login automatizado, APIs não oficiais — **excluídos por decisão de projeto**.

---

## 9. Estratégia de fila

**Postgres como fila.** Sem Redis, sem serviço pago.

- Claim atômico: `UPDATE … WHERE id IN (SELECT id FROM dm_campaign_recipients WHERE status='PENDING' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n)` → `status='SENDING'`, `locked_until = now() + 2min`.
- **Orçamento por tick:** limite oficial é 750/h. Trabalharemos com teto conservador de **600/h ⇒ 10 envios por minuto**, calculado dinamicamente (`600 − enviados na última hora`), e reduzido automaticamente se o header `X-Business-Use-Case-Usage` indicar consumo alto.
- **Backoff exponencial** para erros temporários: 1min → 2 → 4 → 8 → 16 → 32min, máximo 6 tentativas, com jitter.
- **Idempotência em três camadas:** (a) `UNIQUE (campaign_id, comment_id)`; (b) índice único global impedindo duas `SENT` para o mesmo `comment_id`; (c) revalidação no worker imediatamente antes do POST. Um lock expirado que volte para `PENDING` nunca causa envio duplo por causa de (b).
- **Retomada de travados:** job de "unstick" devolve `SENDING` com `locked_until` vencido para `PENDING`.
- **Pausar/Retomar:** flag na campanha, respeitada no claim. Pausar não cancela o que já saiu.

**Agendamento (o ponto de custo):** Vercel Cron no plano Hobby executa **1×/dia**, não serve para o worker. Solução gratuita: **`pg_cron` + `pg_net` no Supabase** (disponível no free tier) fazendo `POST` nos nossos endpoints com header `x-cron-secret`:

| Job | Frequência |
|---|---|
| `dm-worker` | a cada 1 min |
| `snapshot-account` | a cada 1 h (base de todo o crescimento pós-post) |
| `sync-media` | escalonado: mídias <48h a cada 1h; <7d a cada 6h; <30d 1×/dia; >30d 1×/semana |
| `sync-comments` | a cada 15 min (janela de 8 dias) |
| `refresh-token` | 1×/semana |
| `unstick-queue` | a cada 10 min |

Mais o botão **"Sincronizar agora"** e o `kick` pós-confirmação de campanha, para nada depender do relógio quando você está olhando a tela.

---

## 10. Estratégia de snapshots

Princípio: **a Meta devolve estado atual; nós construímos o histórico.** Nada de histórico é sobrescrito — snapshots são append-only.

- `account_snapshots` **de hora em hora**. 24 linhas/dia, ~8.760/ano — irrelevante em espaço, e é o que torna possível `+1h / +3h / +6h / +24h / +48h / +7d` após qualquer publicação sem instrumentação especial por post.
- No momento da conexão: um snapshot imediato + tentativa de **backfill** dos ~30 dias disponíveis via `follower_count`/`follows_and_unfollows`, gravados com `source='meta_backfill'` para nunca serem confundidos com medição própria.
- `media_insight_snapshots` em cadência decrescente (tabela acima) — insights são cumulativos e se movem rápido nas primeiras 48h.
- Crescimento pós-publicação = `followers_count` no snapshot mais próximo de `published_at + Δ` menos o snapshot mais próximo de `published_at`, sempre com o carimbo real do snapshot exibido no tooltip. Se o snapshot não existir (sistema fora do ar), mostramos "não medido" — nunca interpolamos silenciosamente.
- Rótulo em toda a UI: **"crescimento observado após a publicação"**, com tooltip explicando que correlação não é causalidade e que a Meta não fornece atribuição para Reels.

---

## 11. Estratégia de segurança

- **Segredos**: apenas server-side. `NEXT_PUBLIC_` só para URL do app e Supabase URL/anon key. `META_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` nunca chegam ao bundle. `.env.example` com todas as chaves e valores vazios.
- **Token do Instagram criptografado em repouso** (AES-256-GCM), descriptografado só em memória no servidor. Nunca em log, nunca em resposta de API, nunca em view exposta.
- **Webhook**: HMAC-SHA256 sobre o corpo **cru** + `crypto.timingSafeEqual`; corpo não assinado → 401 e descarte; sempre 200 rápido para payload válido (evita reentrega em massa); payload cru guardado com `dedupe_key` único.
- **Cron endpoints** protegidos por `CRON_SECRET` em header, comparado com timing-safe.
- **OAuth**: `state` aleatório assinado em cookie httpOnly para CSRF; `redirect_uri` exata e allowlisted.
- **RLS** em todas as tabelas (§5); service role só no servidor.
- **Logging seguro**: logger com redação de `access_token`, `signature`, `client_secret`, `service_role`. Erros da Meta logados por código + mensagem, sem headers de autorização.
- **LGPD**: `username` + texto de comentário são dados pessoais. Documentar finalidade, e política de retenção (ex.: expurgar comentários `EXPIRED` sem interação após 180 dias) configurável.
- **Anti-abuso próprio**: teto de DMs por hora e por dia, dedupe por pessoa, e nunca "burlar" limites — respeitar `80002` pausando.
- Gates: `security-review` + `code-review` antes de fechar cada fase.

---

## 12. Fases de implementação

Cada fase só é considerada pronta após: `lint` + `typecheck` + testes + `next build` de produção + revisão de RLS/segredos/rate limit/idempotência + revisão de loading/empty/error states + mobile + revisão `impeccable` da UI.

**Fase 0 — Fundação (meio dia)**
Scaffold Next 16 + TS strict + Tailwind v4 + shadcn/ui; shell com sidebar (8 áreas); projeto Supabase; migrations base; tipos gerados; `.env.example`; deploy inicial na Vercel (a URL de produção é pré-requisito do OAuth e do webhook); login por magic link + allowlist.

**Fase 1 — Conexão e ingestão**
`meta-client` + tratamento de erro/paginação/rate-limit; OAuth completo (start/callback/token longo/cripto); `Configurações → Instagram` com todos os status pedidos; sync de conta, mídias e insights; snapshot horário + backfill; `sync_runs`; sync de comentários por polling. **Ao fim da fase 1 já existe histórico acumulando** — é o item mais sensível ao tempo, por isso vem primeiro.

**Fase 2 — Inteligência de crescimento**
Visão Geral (KPIs grandes + gráfico de crescimento com filtros 7d→1a), Crescimento, Conteúdos (tabela densa + filtros + busca), Detalhe do post com KPIs oficiais e "não disponível" explícito, Horários (heatmap dia×hora com mediana + N + faixa de confiança), Frequência. Camada `lib/analytics` em SQL/servidor. Skill `dataviz` aplicada antes do primeiro gráfico.

**Fase 3 — Comentários e private reply individual**
Webhook assinado + `subscribed_apps`; `lib/campaigns/eligibility.ts` como regra única; tela Comentários operacional (abas Todos/Elegíveis/Enviados/Falharam/Expirados, filtros, seleção em massa); envio individual com revalidação server-side; card **OPORTUNIDADES** na Home ligado à tela filtrada. Testável em Development via polling; webhook entra quando o app for Live.

**Fase 4 — Campanhas em fila**
Modal de confirmação com mensagem editável; criação de campanha + recipients; worker + `pg_cron`; progresso em tempo real; pausar/retomar; retry/backoff; classificação de erros; página Campanhas com histórico e crescimento de seguidores no período (rotulado como associação temporal).

**Fase 5 — Refino**
Hoje; timeline crescimento × publicações com marcadores; crescimento pós-publicação completo; templates de mensagem (criar/editar/duplicar/arquivar, com snapshot imutável por campanha); estrutura A/B ativada; webhook `messages` para "respostas recebidas"; funil próprio; benchmark interno; responsividade final (tabelas → cards no mobile); performance.

Fora de escopo, confirmado: IA generativa, previsão, scraping de concorrentes, calendário editorial, publicação automática, download de vídeo, CRM, WhatsApp, e-mail marketing.

---

## 13. O que preciso de você

| # | O que | Onde consigo | Variável |
|---|---|---|---|
| 1 | App da Meta (tipo *Business*) criado, com o produto **Instagram** adicionado | developers.facebook.com/apps → Criar app | — |
| 2 | App ID | App Dashboard → Configurações → Básico | `META_APP_ID` |
| 3 | App Secret | mesma tela → *Mostrar* | `META_APP_SECRET` |
| 4 | Versão da API a fixar | usaremos `v26.0` | `META_API_VERSION` |
| 5 | Confirmação de que `@vamonessasp` é conta **Professional** e que você tem acesso de admin | app do Instagram | — |
| 6 | **"Permitir acesso a mensagens" LIGADO** | Instagram → Configurações → Privacidade → Mensagens → Ferramentas conectadas | — |
| 7 | Projeto Supabase criado (região São Paulo) — URL do projeto | supabase.com/dashboard → Project Settings → API | `NEXT_PUBLIC_SUPABASE_URL` |
| 8 | Chave anon | mesma tela | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| 9 | Chave service role | mesma tela (**nunca no frontend**) | `SUPABASE_SERVICE_ROLE_KEY` |
| 10 | Projeto Vercel + domínio de produção definido | vercel.com | `NEXT_PUBLIC_APP_URL` |
| 11 | E-mail(s) que podem entrar no painel | você | seed em `app_users` |
| 12 | Submissão de App Review para as 4 permissões do §6 (+ verificação de negócio, se exigida) | App Dashboard → Revisão do app | — |
| 13 | Colocar o app em modo **Live** (requisito para webhooks) | App Dashboard | — |

Eu gero, você só cola: `META_WEBHOOK_VERIFY_TOKEN`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`.

URLs que vou precisar cadastrar no App Dashboard (dependem do item 10):
`https://<seu-dominio>/api/auth/instagram/callback` (OAuth Redirect URI) e `https://<seu-dominio>/api/webhooks/instagram` (Webhook Callback URL).

**Não vou inventar nenhum ID, token, secret ou URL.** Enquanto os itens 2, 3, 7, 8, 9 e 10 não existirem, construo tudo com `.env.example` e dados vazios, e as telas mostram o estado "desconectado" real.

---

## 14. O que pode continuar gratuito

- **Meta / Instagram API:** sem custo.
- **Supabase Free:** 500 MB de banco, `pg_cron` + `pg_net` (nosso agendador), Auth, 1 GB de Storage (cache de thumbnails), Realtime. Volume estimado do projeto: snapshots de conta ~9k linhas/ano, snapshots de insights ~50–150k linhas/ano, comentários na casa de dezenas de milhares/ano → **folgadamente dentro do free tier por vários anos**.
- **Vercel Hobby:** suficiente em compute para este uso.
- **Next.js, shadcn/ui, Recharts, framer-motion:** open source.
- Todo o processamento analítico em SQL no Supabase, sem serviço de BI.

## 15. Onde pode nascer custo

| Risco | Quando aparece | Estimativa | Mitigação |
|---|---|---|---|
| **Vercel Hobby proíbe uso comercial** | se o painel é ferramenta de um negócio, o ToS pede plano Pro | ~US$ 20/mês | decisão sua; tecnicamente Hobby funciona |
| Vercel Cron de minuto | só no Pro | idem acima | **evitado** usando `pg_cron` do Supabase |
| Supabase Free pausa projeto inativo | 7 dias sem atividade | — | nosso cron horário mantém ativo |
| Supabase Pro | banco > 500 MB, backup PITR, mais conexões | US$ 25/mês | retenção/expurgo de snapshots antigos; agregação em tabelas diárias |
| Storage de thumbnails | se cachearmos muitas imagens | além de 1 GB | cachear só thumbnail redimensionado; recarregar URL da Meta como fallback |
| Volume de webhooks/execuções | crescimento muito acima do previsto | baixo | batch no upsert; 200 rápido |
| Redis/fila gerenciada | **não previsto** | — | Postgres como fila resolve nesta escala |
| Serviço externo de cron (cron-job.org, GitHub Actions) | só se `pg_net` for insuficiente | grátis nos tiers básicos | plano B |

Custo do MVP funcionando: **R$ 0** de infraestrutura (com a ressalva do ToS da Vercel).

---

## Princípios que serão respeitados sem exceção

1. Nenhuma métrica inventada. Indisponível = `NULL` = "não disponível" na tela.
2. `NULL` ≠ `0`, no banco e na UI.
3. Nunca "seguidores gerados pelo Reel". Sempre "crescimento da conta após a publicação".
4. Nenhuma etapa `DM → FOLLOW` no funil sem atribuição oficial individual (não existe).
5. Nunca "sábado 3h é o melhor horário" — sempre mediana + N + faixa de confiança.
6. Backend é a autoridade da elegibilidade, sempre revalidada no instante do envio.
7. Um private reply por comentário, para sempre. Garantido por constraint, não por lógica.
8. Zero scraping, zero login automatizado, zero API não oficial.
9. Nenhum segredo no frontend.
10. Histórico é append-only e nunca sobrescrito pelo estado atual.
