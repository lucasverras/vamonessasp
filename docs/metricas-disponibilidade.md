# Disponibilidade real de métricas — @vamonessasp

Verificado em **17/08/2026** contra a conta real, não contra a documentação.

**Método:** 276 chamadas somente-leitura. Cada métrica testada **isoladamente** (uma
por requisição, para que uma métrica inválida não derrube as demais), em **7 mídias**
distribuídas por todo o acervo — Reels de 15/08/2026, 11/08/2026, 29/07/2026,
24/08/2025, 21/11/2024, 23/10/2023, e o único post de FEED (23/10/2023) — contra
**5 versões da Graph API**: v22.0, v23.0, v24.0, v25.0 e v26.0.

Autenticação: **Instagram API with Instagram Login**, host `graph.instagram.com`,
token de usuário do Instagram.

---

## Tabela final

| Métrica | Documentação diz que suporta? | Nossa conta retorna? | Endpoint | API version | Erro | Decisão |
|---|---|---|---|---|---|---|
| `views` | FEED, REELS, STORY | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar.** Métrica principal de alcance de conteúdo |
| `reach` | FEED, REELS, STORY | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar** |
| `likes` | FEED, REELS | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar** |
| `comments` | FEED, REELS | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar** |
| `shares` | FEED, REELS, STORY | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar** |
| `saved` | FEED, REELS | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar** |
| `total_interactions` | FEED, REELS, STORY | ✅ **Sim**, em todos os 7 | `/{media-id}/insights` | v22–v26 | — | **Usar.** Apesar de marcada "in development" na doc |
| `ig_reels_avg_watch_time` | REELS | ✅ **Só REELS** (6/6) | `/{media-id}/insights` | v22–v26 | FEED: bloqueio por tipo | **Usar em REELS.** NULL em FEED |
| `ig_reels_video_view_total_time` | REELS | ✅ **Só REELS** (6/6) | `/{media-id}/insights` | v22–v26 | FEED: bloqueio por tipo | **Usar em REELS.** Coluna `bigint` — estoura int32 |
| `reels_skip_rate` | REELS | ✅ **Só REELS** (6/6) | `/{media-id}/insights` | v22–v26 | FEED: bloqueio por tipo | **Usar em REELS.** Percentual |
| `follows` | **FEED e STORY** — a doc **não** lista REELS | ⚠️ **Só FEED** (1/1). ❌ em 6/6 REELS, nas 5 versões | `/{media-id}/insights` | v22–v26 | `[100]` "does not support the **follows** metric for **this media product type**" | **Manter coluna, nullable.** Preencher em FEED; NULL em REELS |
| `profile_visits` | FEED e STORY | ⚠️ **Só FEED** (1/1). ❌ em 6/6 REELS | `/{media-id}/insights` | v22–v26 | `[100]` bloqueio **por tipo de mídia** | **Manter coluna, nullable** |
| `profile_activity` | FEED e STORY | ⚠️ **Só FEED** (1/1). ❌ em 6/6 REELS | `/{media-id}/insights` | v22–v26 | `[100]` bloqueio **por tipo de mídia** | **Manter coluna, nullable** |
| `reposts` | FEED, REELS, STORY | ❌ **Não**, em 7/7 mídias e 5/5 versões — **inclusive FEED** | `/{media-id}/insights` | v22–v26 | `[100]` "Instagram Insights Media API **endpoint** does not support the metrics: reposts" | **Manter coluna, nullable.** Não é limite de tipo: é do endpoint/login |

---

## Por que `reposts` e `follows` falham por motivos diferentes

Ambas **existem** no enum de métricas da API — confirmado pedindo uma métrica
inválida, o que faz a API devolver a lista completa dos 29 nomes aceitos:

```
comments, crossposted_views, facebook_views, follows, ig_reels_avg_watch_time,
ig_reels_video_view_total_time, impressions, likes, link_clicks, navigation,
profile_activity, profile_visits, quotes, reach, reels_skip_rate, replies,
reposts, saved, shares, thread_replies, thread_shares, threads_media_clicks,
threads_reposts, threads_views, total_comments, total_interactions, total_likes,
total_views, views
```

Logo o problema **não é nome de métrica** — testei também `reposts_count`,
`total_reposts`, `shares_and_reposts`, `reshares` e `content_reposts`, todos
rejeitados como nome inválido, enquanto `reposts` é aceito como nome e barrado
depois. A rejeição acontece numa segunda camada, e a mensagem revela qual:

| Classe de erro | Mensagem | Significado | Métricas |
|---|---|---|---|
| **a) Tipo de mídia** | "does not support the X metric for **this media product type**" | Estrutural. REELS nunca terá | `follows`, `profile_visits`, `profile_activity` em REELS; `ig_reels_*`, `reels_skip_rate` em FEED |
| **b) Endpoint / login** | "Instagram Insights Media API **endpoint** does not support the metrics: X" | A métrica existe, mas este host não a serve | `reposts`, `quotes` |
| **c) Outro login** | "The metric X **is not available on this endpoint**" | Documentada como exclusiva de Facebook Login | `total_views`, `total_likes`, `total_comments`, `link_clicks` |

`reposts` falha na classe **(b)**, não na **(a)**: falha igualmente no post de
FEED. Isso descarta a hipótese de restrição por tipo de mídia e aponta para a
autenticação — coerente com o anúncio de abril/2026, que introduziu contagem de
reposts, saves e shares **via Instagram API with Facebook Login**.

**Não foi possível confirmar diretamente.** Testar exigiria um token de Página do
Facebook, e nosso token de Instagram Login é rejeitado por `graph.facebook.com`
com `[190] Cannot parse access token`. Fica registrado como hipótese fundamentada,
não como fato.

## Sobre a premissa de que a doc listaria `follows` para REELS

Reli a referência oficial de Instagram Media Insights duas vezes, com foco
específico nessa questão. A tabela atual lista `follows` para **FEED e STORY**, e
não inclui REELS. Isso coincide com o comportamento observado: a API responde com
bloqueio explícito **por tipo de mídia**, na versão mais recente e em todas as
quatro anteriores, em Reels de 2023 a 2026.

## Campos do objeto media (não são insights)

Nenhum destes existe neste acesso, em nenhuma das 5 versões — `[100] Tried
accessing nonexisting field`:

`reposts_count` · `saved_count` · `shares_count` · `view_count` ·
`total_views_count` · `total_like_count` · `total_comments_count`

Foram anunciados em abril/2026 para Facebook Login. **Toda métrica de engajamento
vem de `/insights`.**

## Consequência de produto

O acervo é **255 REELS + 1 FEED**. Como REELS não expõe `follows`, **não existe
atribuição oficial de seguidores por conteúdo em 99,6% do acervo**.

Por isso o painel mostra *"crescimento observado da conta após a publicação"*,
derivado de `account_snapshots` (nossos, horários), e nunca *"seguidores gerados
pelo Reel"*. No único post de FEED, `follows` oficial é exibido e rotulado como
métrica da Meta.

## Quando reavaliar

- **Se migrarmos para Facebook Login:** `reposts` e os agregados `total_*` podem
  passar a funcionar. As colunas já existem — nenhuma migração necessária.
- **Se publicarmos posts de FEED ou Stories:** `follows`, `profile_visits` e
  `profile_activity` passam a ser preenchidos automaticamente nesses conteúdos.
- **A cada versão nova da Graph API:** reexecutar esta matriz. O script vive em
  `scripts/probe-metrics.ts` (a criar na Fase 1) e o resultado atualiza este
  documento.
