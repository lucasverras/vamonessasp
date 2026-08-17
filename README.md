# Painel Vamo Nessa

Painel interno de crescimento e relacionamento do Instagram **@vamonessasp**.

Objetivo único: **aumentar seguidores**, por dois caminhos.

```
DADOS      → entendimento do crescimento → melhores decisões de publicação
INTERAÇÃO  → oportunidade → private reply → mais chance de follow
```

## Stack

Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · Supabase Postgres ·
Recharts · Vercel · Instagram API with Facebook Login · OpenAI API

## Estado

| Etapa | O que faz | Estado |
|---|---|---|
| 1 | OAuth, sync de conteúdos e insights, snapshots horários, histórico | ✅ |
| 2 | Webhook de comentários em tempo real (3s medidos) | ✅ |
| 3 | Fila de private reply com revalidação, backoff, kill switch | ✅ envio real validado |
| 4 | IA classifica intenção e escreve respostas, em shadow mode | ✅ requer `OPENAI_API_KEY` |
| 5 | Aprovar, editar ou rejeitar cada sugestão no painel | ✅ |
| 6 | Liberar automação por intenção, medida por acerto real | ✅ estrutura pronta |

## Rodar localmente

```bash
npm install
cp .env.example .env.local     # preencher — ver docs/meta-instagram-setup.md
npm run dev
```

Aplicar migrations:

```bash
set -a; . ./.env.local; set +a
REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed 's|https://||;s|\.supabase\.co||')
npx supabase db push --db-url "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.$REF.supabase.co:5432/postgres"
```

Scripts operacionais:

```bash
npm run script -- scripts/sync.ts media          # importar conteúdos
npm run script -- scripts/sync.ts insights       # coletar insights
npm run script -- scripts/sync.ts comentarios    # reconciliar comentários
npm run script -- scripts/sync.ts backfill       # histórico diário
npm run script -- scripts/sync.ts assinar-webhooks
node scripts/db.mjs "select ..."                 # SQL ad-hoc
python3 scripts/compare-logins.py                # matriz de métricas
```

`npm run script` existe porque `server-only` exige a condição `react-server` fora
do runtime do Next.

## Qualidade

```bash
npm run typecheck && npm run lint && npm run build
```

Os três precisam passar antes de qualquer commit.

> **Aviso conhecido:** o projeto está em `~/Desktop`, sincronizado pelo iCloud, o
> que cria arquivos duplicados (`routes.d 2.ts`) dentro de `.next` e quebra o
> typecheck local de forma aleatória. `rm -rf .next` resolve. Mover o projeto para
> fora do Desktop elimina o problema.

## Princípios que o código respeita

1. **`NULL` ≠ `0`.** NULL = a Meta não forneceu. 0 = forneceu zero. Nunca confundidos.
2. **Nenhuma métrica inventada.** Indisponível aparece como "não disponível".
3. **Nunca "seguidores gerados pelo Reel".** A API não fornece atribuição por Reel — verificado em 60 caminhos. Sempre "crescimento observado após a publicação".
4. **Nenhuma etapa `DM → follow`** no funil, porque não existe atribuição individual.
5. **Mediana + N + faixa de confiança** em toda análise de horário. Nunca "sábado 3h é o melhor" com N=1.
6. **Backend é a autoridade** da elegibilidade, revalidada no instante do envio.
7. **Um private reply por comentário, para sempre** — garantido por constraint, não por lógica.
8. **Zero scraping, zero login automatizado, zero API não oficial.**
9. **Nenhum segredo no frontend** — garantido por `server-only`, que faz o build falhar.
10. **Histórico é append-only** e nunca sobrescrito pelo estado atual.

## Documentação

- [docs/architecture.md](docs/architecture.md) — arquitetura, fluxos, banco, fila
- [docs/meta-instagram-setup.md](docs/meta-instagram-setup.md) — configurar o app da Meta
- [docs/private-replies.md](docs/private-replies.md) — regras, limites e o pipeline de envio
- [docs/decisao-login.md](docs/decisao-login.md) — por que Facebook Login, com evidência
- [docs/metricas-disponibilidade.md](docs/metricas-disponibilidade.md) — o que a API entrega de fato
- [docs/plano-tecnico.md](docs/plano-tecnico.md) — plano original
