# Configurar o app da Meta

## Pré-requisitos

- Conta **Professional** no Instagram (Business ou Creator)
- Página do Facebook vinculada à conta profissional
- Domínio HTTPS público (o webhook precisa ser alcançável de fora)

## 1. App

developers.facebook.com/apps → tipo **Business** → adicione **Instagram** e
**Login do Facebook**.

Em **Configurações → Básico**:

| Campo | Valor |
|---|---|
| ID do aplicativo | → `META_APP_ID` |
| Chave secreta | → `META_APP_SECRET` (32 hex) |
| Domínios do app | `seu-dominio.com` (sem `https://`, sem barra) |
| URL do site | `https://seu-dominio.com/` (com barra) |
| Política de privacidade | `https://seu-dominio.com/privacy` |
| Termos de serviço | `https://seu-dominio.com/terms` |

> ⚠️ **A armadilha que custou duas tentativas.** Existem DOIS pares de
> credenciais. As de **Instagram → Configuração da API** não funcionam no
> `graph.facebook.com` — a Meta responde `[190] Cannot get application info`. Use
> sempre as de **Configurações → Básico**.

## 2. Login do Facebook

**Login do Facebook → Configurações → URIs de redirecionamento válidos:**

```
https://seu-dominio.com/api/auth/instagram/callback
```

Sem barra no final. Depois de salvar, **volte e confira** — a Meta às vezes
adiciona uma, e o `redirect_uri` é comparado caractere a caractere.

## 3. Escopos

Ficam em **código** (`lib/env.ts` → `META_SCOPES`), não em variável de ambiente.
Escopos não são segredo e não variam por ambiente; mantê-los em env fazia o
deploy rodar com valor antigo enquanto o repositório já estava correto.

```
instagram_basic · instagram_manage_insights · instagram_manage_comments
instagram_manage_messages · pages_show_list · pages_read_engagement
pages_manage_metadata
```

`pages_messaging` fica de fora de propósito — a Private Reply funciona sem ela.

## 4. Webhooks — DUAS assinaturas

Confundi-las foi a causa de "assinatura ativa, zero entregas".

**a) Objeto `instagram`, nível do APP** — diz *para onde* mandar:

```
POST /{app-id}/subscriptions
  object=instagram  fields=comments
  callback_url=https://seu-dominio.com/api/webhooks/instagram
  verify_token=<META_WEBHOOK_VERIFY_TOKEN>
```

**b) Instalação do app na PÁGINA** — diz *de qual conta* entregar:

```
POST /{page-id}/subscribed_apps  subscribed_fields=name
```

`subscribed_fields` é obrigatório mas **irrelevante** para o Instagram: os
comentários chegam pela assinatura (a). Usamos `name` porque nome de Página
praticamente nunca muda — ruído quase zero. `comments` **não** é campo de Página
e a Meta o recusa listando os válidos.

Ambas são feitas de uma vez:

```bash
npm run script -- scripts/sync.ts assinar-webhooks
```

## 5. Modo Live e Advanced Access

O app precisa estar **Live**. `Advanced Access` para `instagram_manage_comments`
consta como requisito na documentação, mas **a entrega de webhook funcionou sem
ele** — medido: 3 segundos do comentário ao banco. O App Review continua
necessário para o app operar fora do modo de teste.

## 6. Instagram: permitir acesso a mensagens

No app do Instagram: **Configurações → Privacidade → Mensagens → Ferramentas
conectadas → "Permitir acesso a mensagens" LIGADO.** Sem isso o endpoint de
mensagens falha mesmo com a permissão concedida.

## 7. Variáveis de ambiente

Ver `.env.example`. As de produção vão na Vercel — **exceto** as `META_DEV_*` e a
`SUPABASE_DB_PASSWORD`, que são só de desenvolvimento.

> ⚠️ **Variáveis novas só valem em deploys criados depois delas.** Salvar na
> Vercel não atualiza o que já está rodando: é preciso redeployar. Isso custou
> duas rodadas de diagnóstico. `GET /api/health` diz quais faltam, sem revelar
> valores.

## 8. Conectar

```
https://seu-dominio.com/entrar?code=<PANEL_ACCESS_CODE>
```

→ Configurações → **Conectar Instagram**.

`META_TARGET_IG_USER_ID` fixa qual conta conectar. O portfólio tem 8 Páginas, e
escolher "a primeira com Instagram" conectou a conta errada durante os testes —
agora ambiguidade vira erro, nunca palpite.

## Troubleshooting

| Sintoma | Causa |
|---|---|
| `Não é possível carregar a URL` | Domínio ausente em **Domínios do app** ou sem plataforma Site |
| `Invalid Scopes: instagram_business_*` | Escopos do Instagram Login; este fluxo usa `instagram_*` + `pages_*` |
| `invalid redirect_uri` | Barra sobrando, ou URI não cadastrada |
| `[190] Cannot get application info` | App ID/Secret do produto Instagram em vez de Configurações → Básico |
| `PANEL_ACCESS_CODE não configurado` | Variável na Vercel, mas deploy anterior a ela → redeploy |
| Webhook não entrega | App não instalado na Página (assinatura **b**) |
| `[100] Param subscribed_fields must be one of {...}` | `comments` não é campo de Página; use `name` |
| `[200] Requires pages_messaging` | Só para `messages`; a Private Reply não precisa |
| `[3] Application does not have the capability` | Aresta inexistente neste host — `subscribed_apps` na conta IG é do Instagram Login |
