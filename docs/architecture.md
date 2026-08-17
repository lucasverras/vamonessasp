# Arquitetura

## Regra de ouro

```
                       NUNCA
         ┌──────────────╳──────────────┐
    [ Frontend ] ──✕──────────────> [ Meta API ]
```

```
[ Meta API ] ──▶ [ Route Handlers / Server Actions / Cron ] ──▶ [ Supabase ]
                                                                     │
                                                                     ▼
                                                    [ Server Components ] ──▶ [ Client ]
```

Garantido estruturalmente: todo módulo que fala com a Meta ou com o banco importa
`server-only`, e o **build falha** se um Client Component o importar, mesmo
indiretamente. Não depende de ninguém lembrar da regra.

Toda agregação acontece em SQL. O navegador recebe números prontos.

## Camadas

```
lib/
  env.ts                    variáveis validadas + callback URLs (fonte única)
  crypto.ts                 AES-256-GCM dos tokens, bytea, comparação constante
  db.ts                     cliente service role + startSyncRun
  instagram/
    meta-client.ts          única porta de saída para a API
    errors.ts               PERMANENT | TEMPORARY | TOKEN | RATE_LIMIT
    auth.ts                 OAuth: code → curto → longo → Página → Page Token
    account.ts              conta, Page Token decifrado, snapshot
    media.ts                conteúdos e insights por tipo de mídia
    comments.ts             ingestão (webhook + reconciliação), assinatura
    webhooks.ts             HMAC + normalização do payload
    private-replies.ts      POST /{page-id}/messages
    backfill.ts             histórico diário, sondando o limite real
  campaigns/
    eligibility.ts          REGRA ÚNICA de elegibilidade
    create.ts               campanha, dedupe por pessoa, kill switch
    worker.ts               claim → revalidar → enviar → classificar
  ai/
    prompt.ts               prompt versionado (o artefato central)
    analise.ts              classificação + geração, shadow mode
  analytics/                leitura do painel, tudo em SQL
```

## Fluxo: comentário → banco

```
alguém comenta
      ▼
Meta → POST /api/webhooks/instagram
      ├─ lê o corpo CRU (reserializar quebra o HMAC)
      ├─ HMAC-SHA256 + timingSafeEqual  →  ✕ 401, nada gravado
      ├─ grava evento cru (dedupe_key UNIQUE — reentrega colide aqui)
      ├─ UPSERT ignoreDuplicates (comentário existente NÃO é reprocessado:
      │  seu status pode já ser SENT, e sobrescrever reabriria envio duplo)
      ├─ calcula elegibilidade + expiração (7 dias da CRIAÇÃO)
      └─ 200 rápido  (5xx faria a Meta reentregar o que já temos)
```

Medido em produção: **3 segundos** do comentário ao banco.

A reconciliação por polling roda a cada 15 min sobre 9 dias e convive sem
duplicar, porque o upsert é por `instagram_comment_id UNIQUE`. Ela existe porque
webhook não é garantia de entrega — e foi o que manteve a ingestão funcionando
enquanto a assinatura estava incompleta.

## Fluxo: comentário → private reply

```
comentário ELIGIBLE
      ▼
[ IA classifica ]  intenção, risco, textos, decisão   ← shadow: nasce SHADOW
      ▼
[ humano aprova ]  aprovar é a ÚNICA ponte SHADOW → QUEUED
      ▼
[ worker, 1×/min ]
   1. kill switch          desliga tudo, sem consultar nada
   2. orçamento da hora    600/h contra o limite oficial de 750/h
   3. claim atômico        FOR UPDATE SKIP LOCKED
   4. revalidação          por item, passando o próprio id (auto-colisão)
   5. envio                POST /{page-id}/messages
   6. classificação        permanente desiste; temporário recua e volta
      ▼
SENT + contadores recalculados da fonte
```

## Idempotência — em camadas

| Onde | Como |
|---|---|
| Webhook | `webhook_events.dedupe_key UNIQUE` |
| Comentário | `instagram_comment_id UNIQUE` + upsert `ignoreDuplicates` |
| Mídia | `instagram_media_id UNIQUE` |
| Snapshots | `unique (id, captured_at)` com timestamp truncado ao minuto |
| Fila | `unique (campaign_id, comment_id)` |
| **Envio** | **índice único parcial em `(comment_id, action_type) where status='SENT'`** |
| Contadores | recalculados da fonte, nunca incrementados |

A última linha é a que importa: um worker que reprocesse um lote travado **não
consegue** enviar duas vezes, nem que a lógica falhe. Comprovado com teste real.

## Fila

Postgres, sem Redis — nesta escala o banco basta, e um serviço a menos é um modo
de falha a menos.

`reservar_envios` usa `FOR UPDATE SKIP LOCKED`: vários workers em paralelo sem
pegar o mesmo destinatário, e sem que um worker lento bloqueie os outros.
Backoff de 1 a 32 min com jitter. Ao receber rate limit, **para o lote** — a Meta
documenta que insistir estende o bloqueio.

## Agendamento

`pg_cron` + `pg_net` no Supabase, não Vercel Cron: o plano Hobby executa cron
uma vez por dia, o que inviabilizaria o snapshot horário — que é justamente o que
torna possível medir "+1h/+24h após a publicação".

| Job | Cadência |
|---|---|
| `snapshot-account` | 1×/h |
| `sync-media` | 1×/h |
| `sync-insights-recent` | 1×/h (últimos 7 dias) |
| `sync-insights-full` | 1×/dia |
| `backfill-daily` | 1×/dia |
| `sync-comments` | 4×/h |
| `expirar-elegibilidade` | 1×/h |
| `analisar-comentarios` | 12×/h |
| `dm-worker` | 1×/min |
| `destravar-fila` | 6×/h |

O segredo mora em `cron_config`, sem policy de leitura — nunca versionado.

## Banco

18 tabelas, RLS em todas. `anon` não lê nada. Operadores em `app_users` só leem —
e `instagram_accounts`, `webhook_events` e `app_users` ficam **sem policy de
leitura** de propósito: contêm token, payloads crus e a própria lista de acesso.
Toda escrita passa pelo service role, só no servidor.

## Segurança

- Tokens em AES-256-GCM, descriptografados só em memória
- Webhook por HMAC sobre o corpo cru; não assinado → 401 e descarte
- Cron por `x-cron-secret` em comparação de tempo constante
- OAuth com `state` assinado em cookie httpOnly
- Seleção de Página **explícita** (`META_TARGET_IG_USER_ID`) — ambiguidade vira erro
- Logger com redação de token, assinatura e secret

## Dívida conhecida

1. **Acesso ao painel é código compartilhado**, não Supabase Auth. Próximo item.
2. **Tipos do banco não gerados** — `supabase gen types` exige Docker.
3. **`reach` em mídias antigas parece inconsistente** (2,3M views / 13k alcance em 2024). A investigar antes de construir análise sobre ele.
4. **`pages_messaging` não concedida** — bloqueia medir respostas recebidas na DM.
