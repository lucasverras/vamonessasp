# Decisão de arquitetura de autenticação

**Data:** 17/08/2026 · **Método:** teste real contra @vamonessasp, ~900 chamadas
· **Log bruto:** `scripts/out/compare-logins.json` · **Harness:** `scripts/compare-logins.py`

## Decisão

> **FACEBOOK LOGIN** — Instagram API with Facebook Login, host `graph.facebook.com`,
> Page Access Token derivado de token de usuário de longa duração.

Uma única integração em produção. O suporte a Instagram Login é abandonado.

---

## Evidência

Mesma conta (`ig_user_id=17841462357946656`), mesmas mídias (mesmos media ids,
casados por permalink), mesmas métricas, versões v22.0 a v26.0.

### Métricas — Facebook Login é superconjunto estrito

| | Instagram Login | Facebook Login |
|---|---|---|
| views, reach, likes, comments, shares, saved, total_interactions | ✅ | ✅ valores idênticos |
| ig_reels_avg_watch_time, ig_reels_video_view_total_time, reels_skip_rate | ✅ | ✅ valores idênticos |
| **reposts** | ❌ *endpoint does not support* | ✅ **18** |
| **reposts_count** | ❌ campo inexistente | ✅ **18** |
| **saved_count** | ❌ campo inexistente | ✅ **40** |
| **shares_count** | ❌ campo inexistente | ✅ **87** |
| **total_views_count** | ❌ campo inexistente | ✅ **101.185** (vs 100.653 orgânico) |
| **total_like_count** | ❌ campo inexistente | ✅ **748** (vs 739 orgânico) |
| **total_comments_count** | ❌ campo inexistente | ✅ **101** |
| follows / profile_visits / profile_activity em REELS | ❌ | ❌ |

Nenhuma métrica foi perdida. Seis foram ganhas.

### Capacidades operacionais — nada se perde

| Recurso | Verificação | Resultado |
|---|---|---|
| Ler comentários | `GET /{media-id}/comments` | ✅ com `from{id,username}` — o IGSID que a DM exige |
| Insights de conta | `GET /{igba}/insights` | ✅ |
| `follower_count` histórico | 2 anos | ✅ |
| `follows_and_unfollows` | com breakdown | ✅ |
| Conversations | `GET /{page-id}/conversations` | ✅ thread real retornada |
| **Webhooks** | `GET /{page-id}/subscribed_apps` | ✅ HTTP 200 (requer `pages_manage_metadata`) |
| **Private Reply** | `POST /{page-id}/messages` com `comment_id` inválido | ✅ ver abaixo |

### Private Reply — teste conclusivo, sem enviar mensagem a ninguém

Enviar de verdade escreveria para uma pessoa real. Em vez disso, chamamos o
endpoint com `comment_id: "0"`, que não resolve para ninguém, e lemos qual
camada rejeita:

```
POST /362482533610739/messages       HTTP 400  [100] (#100) Invalid comment_id parameter
POST /17841462357946656/messages     HTTP 400  [100] (#100) Invalid comment_id parameter
```

A API rejeitou o **parâmetro**, não a **permissão**. Falta de permissão
retornaria `[200] Requires ... permission`. Logo a capacidade existe, nos dois
endpoints.

Nota: `pages_messaging` **não foi concedida** e ainda assim funciona. A
documentação atual do Instagram Platform exige `instagram_basic` +
`instagram_manage_comments`; a página antiga do Messenger Platform, que cita
`pages_messaging`, está desatualizada para este fluxo.

### Durabilidade do token — medida, não presumida

```
token do Explorer (curto)              expira em 2h
  └─ Page Token derivado               expira em 2h        ← acompanha o pai

fb_exchange_token → token longo        expires_in 5.184.000s = 60 dias
  └─ Page Token derivado               expires_at = 0  →  NUNCA EXPIRA
```

**A propriedade "não expira" é condicional:** só vale para Page Token derivado de
token de usuário de longa duração. Derivado de token curto, expira junto.

Consequência para o produto: a renovação a cada 60 dias **deixa de existir**. O
Instagram Login exigiria cron semanal de refresh e falharia sozinho se ficasse 60
dias sem rodar. Isto elimina uma classe inteira de falha.

---

## O que NÃO muda com a decisão

`follows` por Reel continua indisponível — **nos dois logins**, com mensagem
idêntica: `The Media Insights API does not support the follows metric for this
media product type`. No post de FEED ambos retornam o mesmo valor, o que prova
bloqueio por **tipo de mídia**, não por login, permissão ou versão.

Reafirmando a distinção que importa:

- "O Instagram não tem seguidores por Reel" → **falso**, a interface nativa mostra
- "A API não expõe esse dado por Reel" → **verdadeiro**, verificado em 60 caminhos

As colunas `follows`, `profile_visits`, `profile_activity` permanecem nullable. A
análise pós-publicação segue usando `account_snapshots` e a linguagem
*"crescimento observado após a publicação"*.

---

## Credenciais — correção crítica encontrada

O `META_APP_ID` em uso (`2084751732153304`) era o **ID do produto Instagram**, não
o do aplicativo. A Meta rejeitava o par com `[190] Cannot get application info`.

ID correto, obtido em Configurações → Básico: **`2075592173097492`** (VamoNessaSP).

Isso teria quebrado a verificação HMAC dos webhooks e a troca `code` → token no
OAuth, e só apareceria em produção.

---

## Impacto no plano

| Item | Antes | Depois |
|---|---|---|
| Host | `graph.instagram.com` | `graph.facebook.com` |
| OAuth | Instagram Business Login | Facebook Login → `/me/accounts` → Page Token |
| Token | usuário, 60d, refresh semanal | **Page Token permanente** |
| Escopos | `instagram_business_*` | `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata` |
| Webhooks | `POST /{ig-id}/subscribed_apps` | `POST /{page-id}/subscribed_apps` |
| Private Reply | `POST /{ig-id}/messages` | `POST /{page-id}/messages` (idem payload) |
| Cron de refresh | necessário | **eliminado** |
| Colunas novas preenchíveis | — | `reposts`, e os agregados `total_*` |

Nenhuma alteração destrutiva de schema: as colunas contestadas já existiam
nullable e passam a ser preenchidas.
