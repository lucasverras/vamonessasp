# Private Replies

## Regras oficiais da Meta — verificadas, não presumidas

| Regra | Verificação |
|---|---|
| Janela de **7 dias** da **criação** do comentário | Documentação oficial. Conta da criação, não do recebimento do webhook — um worker atrasado queima a janela |
| **Uma** mensagem por comentário, **para sempre** | Documentação oficial |
| **750 chamadas/hora** para comentários de post e reel | Documentação oficial de rate limits |
| Erro `80002` = rate limit | Insistir **estende** o bloqueio |

## Endpoint

```http
POST https://graph.facebook.com/v26.0/{page-id}/messages
{ "recipient": { "comment_id": "<ID>" }, "message": { "text": "..." } }
```

Permissões: `instagram_basic` + `instagram_manage_comments`.
**`pages_messaging` NÃO é necessária** — comprovado: com ela ausente, o endpoint
recusa o *parâmetro* (`[100] Invalid comment_id`), não a permissão. A página do
Messenger Platform que a exige está desatualizada para este fluxo.

## Elegibilidade — regra única

`lib/campaigns/eligibility.ts` é a autoridade. A tela apenas exibe o que ele
decidiu; o worker o consulta **de novo** no instante do envio.

| Motivo | Origem |
|---|---|
| `FORA_DA_JANELA` | 7 dias da criação — regra da Meta |
| `JA_RESPONDIDO` | uma por comentário — regra da Meta |
| `JA_NA_FILA` | ação pendente para o mesmo comentário — nossa |
| `SEM_IGSID` | sem IGSID não há destinatário |
| `COMENTARIO_PROPRIO` | comentário da própria conta |
| `COMENTARIO_APAGADO` | deletado |
| `PESSOA_NA_BLACKLIST` | bloqueio manual, permanente |
| `COOLDOWN_DA_PESSOA` | 90 dias — **nossa, mais restritiva que a Meta exige** |

O cooldown existe para que alguém que comenta em todo Reel não receba mensagem
toda semana. A Meta permitiria; nós não.

## O que o kill switch faz e o que não faz

Ele bloqueia **envio**, não a criação da fila. A distinção custou um bug: a
checagem estava em `revalidar()`, e o sistema recusava até *montar* a fila, ao
contrário do que a interface prometia.

- `revalidar()` responde: *este comentário pode receber mensagem?*
- worker responde: *o sistema deve estar enviando agora?*

## Pipeline

```
seleção (intenção)  →  criarCampanha  →  QUEUED  →  worker  →  SENT
                       revalida cada         revalida de novo
                       dedupe por pessoa     no instante do envio
```

Dedupe por pessoa na criação: quem comentou três vezes recebe **uma** mensagem.
Sem isso o sistema faria o oposto do objetivo.

## Classificação de erro

| Classe | Códigos | Ação |
|---|---|---|
| `TOKEN` | 190, 102, 463, 467 | pausa campanhas, alerta em Configurações |
| `RATE_LIMIT` | 80002, 4, 17, 32, 613, HTTP 429 | **para o lote** |
| `TEMPORARY` | 1, 2, HTTP 5xx | backoff 1→32 min com jitter, até 6 tentativas |
| `PERMANENT` | 10, 200–299, 100 | desiste; grava o motivo em português |

## Testes reais executados

**Com kill switch ligado** — o script aborta se o encontrar desligado:
4 comentários revalidados, 3 enfileirados, 1 removido por repetir a mesma pessoa,
worker parou em `KILL_SWITCH` sem alterar nenhum estado, segunda tentativa
recusou os 4.

**Envio real**, um único comentário do dono da conta, autorizado: `SENT` com
`message_id` da Meta. As proteções seguraram em três camadas independentes —
`JA_RESPONDIDO` na criação, `COOLDOWN_DA_PESSOA` em outro comentário da mesma
pessoa, e a constraint do banco barrando um segundo `SENT` inserido à força.

## Três defeitos que só o envio real revelou

1. **Auto-colisão.** O worker reserva marcando `SENDING` e então revalida — e encontrava a própria ação, concluindo `JA_NA_FILA` e ignorando todo envio. Sem erro, com motivo plausível no log.
2. **Colunas inexistentes.** O worker escrevia em `private_reply_sent_at`, removida do schema na reescrita para IA.
3. **O pior: esse update falhava em silêncio.** A DM saiu e o comentário ficou `ELIGIBLE` — a tela mostraria a pessoa como disponível de novo. Divergência pior que falha: uma falha se repete sem dano, esta duplica mensagem.

## O que a API não permite

- Atribuir um seguidor a uma DM — **não existe**, e por isso o funil não tem essa etapa
- Saber se alguém já segue a conta
- Mais de um private reply por comentário
- Enviar depois de 7 dias
- DM para quem não comentou (não existe cold DM oficial)
