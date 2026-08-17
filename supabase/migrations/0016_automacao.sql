-- =============================================================================
-- Automação de respostas: a regra USER+MEDIA no banco, agendamento com atraso,
-- modo dry-run e rastreabilidade de quem respondeu.
-- =============================================================================

-- 1. A linha de envio passa a saber DE QUEM e DE QUAL CONTEÚDO ela é.
--    Sem isso o banco não consegue expressar "uma DM por pessoa por conteúdo".
alter table comment_actions
  add column if not exists instagram_user_id text,
  add column if not exists media_id uuid references instagram_media(id) on delete cascade,
  add column if not exists reply_source text check (reply_source in ('AI', 'HUMAN')),
  add column if not exists responded_by text;

update comment_actions a
   set instagram_user_id = c.instagram_user_id,
       media_id = c.media_id
  from instagram_comments c
 where c.id = a.comment_id
   and (a.instagram_user_id is null or a.media_id is null);

-- Daqui em diante toda ação nasce com os dois preenchidos (o código garante;
-- not null não é possível porque ações antigas de comentários apagados podem
-- ter user nulo).

-- 2. DRY_RUN entra no vocabulário de status: processado até o fim, nunca
--    enviado. Não é SKIPPED (não foi recusado) nem SHADOW (passou pela fila).
alter table comment_actions drop constraint if exists comment_actions_status_check;
alter table comment_actions add constraint comment_actions_status_check check (
  status in ('SHADOW','PENDING_APPROVAL','APPROVED','REJECTED','QUEUED','SENDING',
             'SENT','FAILED','SKIPPED','EXPIRED','DRY_RUN')
);

-- 3. AS DUAS GARANTIAS. Constraint, não if:
--    o INSERT é a reserva — dois webhooks, dois workers, um retry e uma
--    reentrega disputam a mesma linha e o segundo recebe 23505.

-- Uma private reply por PESSOA+CONTEÚDO (pendentes contam como reserva).
create unique index if not exists comment_actions_uma_dm_por_pessoa_conteudo
  on comment_actions (instagram_user_id, media_id)
  where action_type = 'PRIVATE_REPLY'
    and status in ('PENDING_APPROVAL','APPROVED','QUEUED','SENDING','SENT');

-- Uma resposta pública por COMENTÁRIO (dedupe por comment_id, não por pessoa:
-- cada comentário é uma interação independente).
create unique index if not exists comment_actions_uma_publica_por_comentario
  on comment_actions (comment_id)
  where action_type = 'PUBLIC_REPLY'
    and status in ('PENDING_APPROVAL','APPROVED','QUEUED','SENDING','SENT');

-- FAILED fica fora dos predicados de propósito: falha permanente libera o slot.

-- 4. Modos e cadência da automação.
alter table automation_settings
  -- OFF: só registra (SHADOW). DRY_RUN: percorre a fila inteira e para na
  -- beira do envio. LIVE: envia. O kill switch continua SUPREMO sobre os três.
  add column if not exists reply_mode text not null default 'DRY_RUN'
    check (reply_mode in ('OFF','DRY_RUN','LIVE')),
  -- Atraso humano: nada de responder em segundos. Sorteado por ação.
  add column if not exists delay_min_seconds int not null default 180,
  add column if not exists delay_max_seconds int not null default 420,
  -- O que pode ser automático, por categoria de interação.
  add column if not exists reply_praise boolean not null default true,
  add column if not exists reply_known_questions boolean not null default true,
  add column if not exists reply_mentions boolean not null default true,
  -- Marco de início: só comentário DEPOIS disto entra no pipeline automático.
  -- Sem o marco, ligar a automação despejaria a fila histórica de uma vez.
  add column if not exists automation_started_at timestamptz;

alter table automation_settings
  add constraint automation_delay_valido
  check (delay_min_seconds >= 0 and delay_max_seconds >= delay_min_seconds);

-- 5. Análise ganha razão legível por máquina e inventário de fatos.
alter table comment_analyses
  add column if not exists decision_reason_code text,
  add column if not exists facts_available text[],
  add column if not exists facts_missing text[];

-- 6. O cooldown global morre (regra do produto: pessoa+conteúdo, não pessoa).
--    A coluna cooldown_days_per_user fica — vira informação, não bloqueio.
--    last_private_reply_at idem. Nenhum dado apagado.

-- 7. Elegibilidade por par: o motivo novo para o caso "mesma pessoa, mesmo
--    conteúdo, segundo comentário" — não é erro, é a regra funcionando.
--    (Vocabulário usado pelo código; aqui só documentado.)

grant execute on function reservar_envios(int, text, int) to service_role;
