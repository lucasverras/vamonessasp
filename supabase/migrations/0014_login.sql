-- Login de verdade, substituindo o código compartilhado em cookie.
--
-- O portão anterior era um segredo único: quem tivesse o código era "o painel",
-- sem nome e sem papel. Não dava para saber quem aprovou uma mensagem, nem
-- impedir que alguém desligasse o kill switch.

create table if not exists panel_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  -- Formato: scrypt$N$r$p$salt_b64$hash_b64. Nunca a senha em claro.
  password_hash text not null,
  -- ADMIN muda configuração, dispara envio e conecta contas.
  -- OPERADOR trabalha comentários e revisa sugestões, e só.
  role text not null check (role in ('ADMIN', 'OPERADOR')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Toda tentativa fica registrada. Sem isto não há como notar força bruta, e as
-- senhas em uso são curtas o bastante para que isso importe de verdade.
create table if not exists panel_login_attempts (
  id bigserial primary key,
  username text not null,
  ip text,
  ok boolean not null,
  at timestamptz not null default now()
);

create index if not exists panel_login_attempts_janela_idx
  on panel_login_attempts (username, at desc);
create index if not exists panel_login_attempts_ip_idx
  on panel_login_attempts (ip, at desc) where ip is not null;

alter table panel_users enable row level security;
alter table panel_login_attempts enable row level security;

-- Sem policy: apenas a service_role (servidor) enxerga. O anon key nunca lê
-- hash de senha, nem por engano de query.

create or replace function panel_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists panel_users_updated_at on panel_users;
create trigger panel_users_updated_at
  before update on panel_users
  for each row execute function panel_touch_updated_at();
