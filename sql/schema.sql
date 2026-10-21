-- ============================================================================
-- ROTA SEGURA — BLOCO 1: BANCO DE DADOS COMPLETO
-- ----------------------------------------------------------------------------
-- COMO USAR:
--   1. Abra o painel do Supabase (https://supabase.com/dashboard)
--   2. Escolha seu projeto
--   3. Menu lateral esquerdo -> "SQL Editor"
--   4. Botão "+ New query"
--   5. Cole TODO este arquivo e clique em "Run" (ou Ctrl+Enter)
--
-- Este script pode ser rodado mais de uma vez sem quebrar (é idempotente).
-- ============================================================================


-- ============================================================================
-- 1. EXTENSÕES
-- ============================================================================
create extension if not exists "pgcrypto";   -- para gen_random_uuid()


-- ============================================================================
-- 2. FUNÇÃO AUXILIAR: atualizar updated_at automaticamente
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- 3. TABELA: profiles (perfil público do usuário)
--    Ligada 1-para-1 com auth.users (tabela interna do Supabase Auth).
--    A SENHA NUNCA fica aqui — quem cuida disso é o Supabase Auth.
-- ============================================================================
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null default '',
  email             text,
  phone             text,
  avatar_url        text,
  accepted_terms    boolean not null default false,
  accepted_privacy  boolean not null default false,
  -- Rota Segura 2.0: prioridade da rota (controle #rota-preferencia em
  -- pages/rotas.html) — o quanto o risco de segurança pesa contra a duração
  -- na escolha da rota (ver PESO_SEGURANCA_POR_PREFERENCIA em js/routes.js).
  preferencia_rota  text not null default 'segura'
                      check (preferencia_rota in ('segura', 'equilibrada', 'rapida')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Quem já tinha a tabela `profiles` criada antes do Rota Segura 2.0 (create
-- table if not exists acima não adiciona coluna em tabela que já existe).
alter table public.profiles
  add column if not exists preferencia_rota text not null default 'segura';
alter table public.profiles
  drop constraint if exists profiles_preferencia_rota_check;
alter table public.profiles
  add constraint profiles_preferencia_rota_check
    check (preferencia_rota in ('segura', 'equilibrada', 'rapida'));

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 3.1 Trigger: quando alguém se cadastra, cria o perfil automaticamente
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone, accepted_terms, accepted_privacy)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    coalesce((new.raw_user_meta_data ->> 'accepted_terms')::boolean, false),
    coalesce((new.raw_user_meta_data ->> 'accepted_privacy')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 4. TABELA: emergency_contacts (contatos de emergência — dado PRIVADO)
-- ============================================================================
create table if not exists public.emergency_contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  phone         text not null,
  relationship  text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_emergency_contacts_user on public.emergency_contacts(user_id);

drop trigger if exists trg_emergency_contacts_updated_at on public.emergency_contacts;
create trigger trg_emergency_contacts_updated_at
  before update on public.emergency_contacts
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 5. TABELA: reports (relatos de segurança)
-- ============================================================================
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in (
                    'assedio_verbal',
                    'assedio_fisico',
                    'assalto',
                    'perseguicao',
                    'rua_pouco_iluminada',
                    'local_isolado',
                    'outro'
                  )),
  description     text,
  address         text,
  lat             double precision not null,
  lng             double precision not null,
  occurred_at     timestamptz not null default now(),
  attention_level text not null default 'medio' check (attention_level in ('baixo','medio','alto')),
  image_url       text,
  -- MODERAÇÃO: mude o default para 'pending' se quiser aprovar antes de publicar.
  status          text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_reports_user       on public.reports(user_id);
create index if not exists idx_reports_status     on public.reports(status);
create index if not exists idx_reports_created_at on public.reports(created_at desc);
-- Índice geográfico simples (consulta por retângulo visível no mapa)
create index if not exists idx_reports_lat_lng    on public.reports(lat, lng);

drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- MIGRAÇÃO: "create table if not exists" acima não altera uma tabela que já
-- existe — então, se seu banco já tinha reports antes de "assalto" ser
-- adicionado, o "if not exists" sozinho não bastava. Isto recria só a regra
-- de validação (constraint), sem tocar em nenhuma linha já cadastrada — os
-- relatos antigos continuam válidos porque seus tipos continuam na lista.
alter table public.reports drop constraint if exists reports_type_check;
alter table public.reports add constraint reports_type_check check (type in (
  'assedio_verbal', 'assedio_fisico', 'assalto', 'perseguicao',
  'rua_pouco_iluminada', 'local_isolado', 'outro'
));

-- "create table if not exists" acima não adiciona coluna nova a uma tabela
-- "reports" que já existia antes deste recurso — por isso o "add column if
-- not exists" separado aqui. NULL = sem prazo (comportamento de sempre,
-- fica visível até alguém apagar); preenchido = some da lista pública
-- sozinho quando passa da hora (ver policy "relatos_leitura" acima e o
-- campo "Por quanto tempo" no formulário de relato, js/reports.js).
alter table public.reports add column if not exists expires_at timestamptz;


-- ============================================================================
-- 6. TABELA: support_points (pontos de apoio: farmácia, hospital, ponto de ônibus...)
-- ============================================================================
create table if not exists public.support_points (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  type         text not null check (type in (
                 'ponto_apoio',
                 'farmacia',
                 'hospital',
                 'comercio_24h',
                 'ponto_onibus',
                 'outro'
               )),
  name         text not null,
  address      text,
  lat          double precision not null,
  lng          double precision not null,
  phone        text,
  description  text,
  opening_hours text,
  extra_info   text,
  status       text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_support_points_status  on public.support_points(status);
create index if not exists idx_support_points_lat_lng on public.support_points(lat, lng);

drop trigger if exists trg_support_points_updated_at on public.support_points;
create trigger trg_support_points_updated_at
  before update on public.support_points
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 7. TABELA: police_stations (delegacias — em especial as DEAMs)
-- ============================================================================
create table if not exists public.police_stations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  phone         text,
  is_women_only boolean not null default false,  -- true = delegacia da mulher
  opening_hours text,
  description   text,
  status        text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_police_stations_status  on public.police_stations(status);
create index if not exists idx_police_stations_lat_lng on public.police_stations(lat, lng);

drop trigger if exists trg_police_stations_updated_at on public.police_stations;
create trigger trg_police_stations_updated_at
  before update on public.police_stations
  for each row execute function public.set_updated_at();


-- ============================================================================
-- 8. TABELA: posts (publicações da Comunidade — usada no Bloco 3)
-- ============================================================================
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null check (category in ('alerta','dica','apoio','noticia')),
  title        text,
  content      text not null,
  address      text,
  lat          double precision,
  lng          double precision,
  image_url    text,
  likes_count  integer not null default 0,
  status       text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- MIGRAÇÃO: "status_resposta" (marcar publicação como resolvida) existiu por
-- uma rodada do Rota Segura 2.0 e foi removida de volta a pedido explícito —
-- a tela ficava feia/confusa com o botão, e não era essencial. Quem já tinha
-- rodado a versão com essa coluna (schema.sql de antes) tem ela apagada
-- aqui; quem nunca rodou, nem chega a criar (a tabela acima já nasce sem
-- ela). "drop column if exists" também remove a constraint associada
-- sozinho, não precisa de um "drop constraint" separado.
-- CASCADE: a view posts_publico (seção 9.2 logo abaixo) ainda referenciava
-- essa coluna — sem cascade, o Postgres recusa o drop (erro 2BP01, "outros
-- objetos dependem"). A própria seção 9.2 apaga e recria essa view sem a
-- coluna de qualquer jeito, então o cascade aqui não perde nada.
alter table public.posts drop column if exists status_resposta cascade;

create index if not exists idx_posts_status     on public.posts(status);
create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_posts_user       on public.posts(user_id);

drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- "create table if not exists" acima não adiciona coluna nova a uma tabela
-- que já existia antes desta funcionalidade — por isso o "add column"
-- separado, idempotente.
alter table public.posts add column if not exists is_anonymous boolean not null default false;


-- ============================================================================
-- 9. TABELA: post_likes (curtidas — 1 curtida por usuário por publicação)
-- ============================================================================
create table if not exists public.post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)   -- impede curtir duas vezes
);

create index if not exists idx_post_likes_post on public.post_likes(post_id);
create index if not exists idx_post_likes_user on public.post_likes(user_id);

-- Mantém posts.likes_count sempre correto
create or replace function public.sync_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_likes_sync on public.post_likes;
create trigger trg_post_likes_sync
  after insert or delete on public.post_likes
  for each row execute function public.sync_likes_count();


-- ============================================================================
-- 9.1 TABELA: post_comments (comentários nas publicações da Comunidade)
--     Adicionada depois do resto do Bloco 3. A regra original do PDF dizia
--     "só curtir, sem comentários" — foi revista a pedido explícito depois de
--     testar o app pronto. Segue o mesmo padrão de post_likes: tabela própria,
--     contador sincronizado por gatilho em posts, RLS "só a autora edita/
--     apaga o que é dela".
-- ============================================================================
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_post_comments_post on public.post_comments(post_id, created_at);

-- "create table if not exists" acima não adiciona coluna nova a uma tabela
-- "posts" que já existia antes deste comentário ser escrito — por isso o
-- "add column if not exists" separado aqui, idempotente e seguro de rodar
-- de novo mesmo se posts já tiver a coluna.
alter table public.posts add column if not exists comments_count integer not null default 0;

-- Mantém posts.comments_count sempre correto (mesmo padrão de sync_likes_count)
create or replace function public.sync_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_comments_sync on public.post_comments;
create trigger trg_post_comments_sync
  after insert or delete on public.post_comments
  for each row execute function public.sync_comments_count();


-- ---------------------------------------------------------------------------
-- 9.2 VIEW: posts_publico — publicações da Comunidade, mas SEM revelar quem
-- postou quando is_anonymous = true.
--
-- Por que uma view (e não só esconder o nome na tela): esconder só na
-- interface não protege de verdade — qualquer pessoa com o navegador aberto
-- no console conseguiria ler o user_id de uma publicação "anônima" na
-- resposta da rede e, como a tabela profiles permite leitura pra qualquer
-- usuária autenticada, descobrir quem publicou mesmo assim. Esta view troca
-- o user_id por null ANTES de sair do banco, então a informação nunca chega
-- ao navegador de outras pessoas pra publicações marcadas como anônimas —
-- só quem já é a própria autora (via "Minhas publicações", que consulta a
-- tabela real, não esta view) continua vendo os detalhes de tudo que é dela.
-- `security_invoker = true` garante que o RLS de public.posts continua
-- valendo normalmente para quem consulta esta view (não é uma forma de
-- burlar a segurança, só de mascarar uma coluna).
-- ---------------------------------------------------------------------------
-- IMPORTANTE: "create or replace view" do Postgres não deixa TIRAR uma
-- coluna de uma view que já existe (só deixar igual ou ACRESCENTAR no fim —
-- erro 42P16 se a lista encolher ou mudar de ordem). Por isso, pra remover
-- de vez status_resposta (ver MIGRAÇÃO na tabela 8 acima — a coluna foi
-- removida da tabela), esta view precisa ser apagada e recriada do zero em
-- vez de um simples "or replace"; a permissão de select é refeita logo
-- abaixo de qualquer jeito, então não se perde nada.
drop view if exists public.posts_publico;
create view public.posts_publico
with (security_invoker = true) as
select
  id, category, title, content, address, lat, lng, image_url,
  likes_count, comments_count, status, created_at,
  case when is_anonymous then null else user_id end as user_id,
  is_anonymous
from public.posts;

grant select on public.posts_publico to authenticated;


-- ============================================================================
-- 10. TABELA: notifications (notificações do sino)
-- ============================================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  type       text not null default 'info' check (type in ('info','alerta','moderacao','sistema')),
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread on public.notifications(user_id, is_read);


-- ============================================================================
-- 11. TABELA: route_history (histórico de rotas — usada no Bloco 2)
-- ============================================================================
create table if not exists public.route_history (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  origin_address      text,
  origin_lat          double precision,
  origin_lng          double precision,
  destination_address text,
  destination_lat     double precision,
  destination_lng     double precision,
  distance_meters     integer,
  duration_seconds    integer,
  created_at          timestamptz not null default now()
);

create index if not exists idx_route_history_user on public.route_history(user_id, created_at desc);


-- ============================================================================
-- 12. ROW LEVEL SECURITY (RLS)
--     Sem isso, qualquer pessoa com a chave pública leria tudo.
-- ============================================================================
alter table public.profiles           enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.reports            enable row level security;
alter table public.support_points     enable row level security;
alter table public.police_stations    enable row level security;
alter table public.posts              enable row level security;
alter table public.post_likes         enable row level security;
alter table public.post_comments      enable row level security;
alter table public.notifications      enable row level security;
alter table public.route_history      enable row level security;


-- ---------------------------------------------------------------------------
-- 12.1 profiles
-- ---------------------------------------------------------------------------
drop policy if exists "perfis_publicos_leitura" on public.profiles;
create policy "perfis_publicos_leitura"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "perfil_proprio_insert" on public.profiles;
create policy "perfil_proprio_insert"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "perfil_proprio_update" on public.profiles;
create policy "perfil_proprio_update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- 12.2 emergency_contacts — 100% privado
-- ---------------------------------------------------------------------------
drop policy if exists "contatos_proprios_select" on public.emergency_contacts;
create policy "contatos_proprios_select"
  on public.emergency_contacts for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "contatos_proprios_insert" on public.emergency_contacts;
create policy "contatos_proprios_insert"
  on public.emergency_contacts for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "contatos_proprios_update" on public.emergency_contacts;
create policy "contatos_proprios_update"
  on public.emergency_contacts for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "contatos_proprios_delete" on public.emergency_contacts;
create policy "contatos_proprios_delete"
  on public.emergency_contacts for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.3 reports — leio os aprovados + os meus (mesmo pendentes)
-- ---------------------------------------------------------------------------
-- Relato com prazo vencido (expires_at) some da visão pública assim que passa
-- da hora — mas a própria autora continua vendo o que é dela (segunda metade
-- do "or"), do mesmo jeito que já acontecia com relato pendente/rejeitado.
drop policy if exists "relatos_leitura" on public.reports;
create policy "relatos_leitura"
  on public.reports for select
  to authenticated
  using (
    (status = 'approved' and (expires_at is null or expires_at > now()))
    or auth.uid() = user_id
  );

drop policy if exists "relatos_insert_proprio" on public.reports;
create policy "relatos_insert_proprio"
  on public.reports for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "relatos_update_proprio" on public.reports;
create policy "relatos_update_proprio"
  on public.reports for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "relatos_delete_proprio" on public.reports;
create policy "relatos_delete_proprio"
  on public.reports for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.4 support_points
-- ---------------------------------------------------------------------------
drop policy if exists "pontos_leitura" on public.support_points;
create policy "pontos_leitura"
  on public.support_points for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

-- Ponto de apoio virou "lugar parceiro" cadastrado só pela administradora do
-- projeto (não existe mais formulário público pra isso — ver js/support-points.js
-- e pages/mapa.html). De propósito NÃO existe mais policy de insert/update/delete
-- pra `authenticated` aqui: com só uma administradora, criar uma coluna/role de
-- admin seria complexidade nova sem necessidade — ela mesma cadastra direto pelo
-- Table Editor ou SQL Editor do Supabase (que ignoram RLS), documentado em
-- GUIA_PASSO_A_PASSO.md. Estas 3 linhas só APAGAM as policies antigas (de quando
-- qualquer usuária logada podia inserir) — sem recriar nada no lugar.
drop policy if exists "pontos_insert_proprio" on public.support_points;
drop policy if exists "pontos_update_proprio" on public.support_points;
drop policy if exists "pontos_delete_proprio" on public.support_points;


-- ---------------------------------------------------------------------------
-- 12.5 police_stations
-- ---------------------------------------------------------------------------
drop policy if exists "delegacias_leitura" on public.police_stations;
create policy "delegacias_leitura"
  on public.police_stations for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

-- Mesmo motivo/mesma decisão de support_points (seção 12.4 acima): delegacia
-- virou "lugar parceiro" cadastrado só pela administradora, direto pelo
-- Table Editor/SQL Editor do Supabase — não existe mais formulário público
-- pra isso (js/support-points.js foi removido, pages/mapa.html não tem mais
-- o modal de cadastro). Só apaga as policies antigas, sem recriar.
drop policy if exists "delegacias_insert_proprio" on public.police_stations;
drop policy if exists "delegacias_update_proprio" on public.police_stations;
drop policy if exists "delegacias_delete_proprio" on public.police_stations;


-- ---------------------------------------------------------------------------
-- 12.6 posts
-- ---------------------------------------------------------------------------
drop policy if exists "posts_leitura" on public.posts;
create policy "posts_leitura"
  on public.posts for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

drop policy if exists "posts_insert_proprio" on public.posts;
create policy "posts_insert_proprio"
  on public.posts for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "posts_update_proprio" on public.posts;
create policy "posts_update_proprio"
  on public.posts for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "posts_delete_proprio" on public.posts;
create policy "posts_delete_proprio"
  on public.posts for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.7 post_likes — curtir/descurtir só o próprio like
-- ---------------------------------------------------------------------------
drop policy if exists "likes_leitura" on public.post_likes;
create policy "likes_leitura"
  on public.post_likes for select
  to authenticated using (true);

drop policy if exists "likes_insert_proprio" on public.post_likes;
create policy "likes_insert_proprio"
  on public.post_likes for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "likes_delete_proprio" on public.post_likes;
create policy "likes_delete_proprio"
  on public.post_likes for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.8 notifications — só as minhas
-- ---------------------------------------------------------------------------
drop policy if exists "notificacoes_proprias_select" on public.notifications;
create policy "notificacoes_proprias_select"
  on public.notifications for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "notificacoes_proprias_update" on public.notifications;
create policy "notificacoes_proprias_update"
  on public.notifications for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notificacoes_proprias_delete" on public.notifications;
create policy "notificacoes_proprias_delete"
  on public.notifications for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.9 route_history — só as minhas
-- ---------------------------------------------------------------------------
drop policy if exists "rotas_proprias_select" on public.route_history;
create policy "rotas_proprias_select"
  on public.route_history for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "rotas_proprias_insert" on public.route_history;
create policy "rotas_proprias_insert"
  on public.route_history for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "rotas_proprias_delete" on public.route_history;
create policy "rotas_proprias_delete"
  on public.route_history for delete
  to authenticated using (auth.uid() = user_id);


-- ============================================================================
-- 12.10 Gatilho: notificar a autora do post quando alguém curte (Bloco 3)
--       Só gera notificação real quando existe um evento real (uma curtida).
--       Pula autocurtida (curtir a própria publicação não gera notificação).
-- ============================================================================
create or replace function public.notificar_curtida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  autor_id uuid;
  nome_de_quem_curtiu text;
begin
  select user_id into autor_id from public.posts where id = new.post_id;
  if autor_id is null or autor_id = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'Alguém') into nome_de_quem_curtiu
  from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, title, body, type, link)
  values (
    autor_id,
    'Nova curtida na sua publicação',
    nome_de_quem_curtiu || ' curtiu o que você publicou.',
    'info',
    'pages/alertas.html'
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_curtida on public.post_likes;
create trigger trg_notificar_curtida
  after insert on public.post_likes
  for each row execute function public.notificar_curtida();


-- ---------------------------------------------------------------------------
-- 12.11 post_comments — ler qualquer comentário, escrever/apagar só o próprio
-- ---------------------------------------------------------------------------
drop policy if exists "comentarios_leitura" on public.post_comments;
create policy "comentarios_leitura"
  on public.post_comments for select
  to authenticated using (true);

drop policy if exists "comentarios_insert_proprio" on public.post_comments;
create policy "comentarios_insert_proprio"
  on public.post_comments for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "comentarios_delete_proprio" on public.post_comments;
create policy "comentarios_delete_proprio"
  on public.post_comments for delete
  to authenticated using (auth.uid() = user_id);


-- ============================================================================
-- 12.12 Gatilho: notificar a autora do post quando alguém comenta (Bloco 3)
--       Mesmo padrão de notificar_curtida — pula autocomentário.
-- ============================================================================
create or replace function public.notificar_comentario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  autor_id uuid;
  nome_de_quem_comentou text;
begin
  select user_id into autor_id from public.posts where id = new.post_id;
  if autor_id is null or autor_id = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'Alguém') into nome_de_quem_comentou
  from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, title, body, type, link)
  values (
    autor_id,
    'Novo comentário na sua publicação',
    nome_de_quem_comentou || ' comentou: "' || left(new.content, 80) || '"',
    'info',
    'pages/alertas.html'
  );
  return new;
end;
$$;

drop trigger if exists trg_notificar_comentario on public.post_comments;
create trigger trg_notificar_comentario
  after insert on public.post_comments
  for each row execute function public.notificar_comentario();


-- ============================================================================
-- 13. STORAGE — bucket para imagens de relatos e publicações
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('rota-segura', 'rota-segura', true)
on conflict (id) do nothing;

drop policy if exists "storage_leitura_publica" on storage.objects;
create policy "storage_leitura_publica"
  on storage.objects for select
  to public
  using (bucket_id = 'rota-segura');

-- Cada usuário só grava dentro da pasta com o próprio ID: rota-segura/<uid>/arquivo.jpg
drop policy if exists "storage_upload_proprio" on storage.objects;
create policy "storage_upload_proprio"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'rota-segura'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "storage_delete_proprio" on storage.objects;
create policy "storage_delete_proprio"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'rota-segura'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================================
-- 14. REALTIME — avisar o app quando entrar relato novo
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.reports;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.posts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.post_comments;
  exception when duplicate_object then null;
  end;
end $$;


-- ============================================================================
-- 15. TABELA: enderecos_rio — base de endereços do Rio de Janeiro com número
--     e coordenada exatos, vinda do CNEFE (Censo Demográfico 2022, IBGE:
--     https://www.ibge.gov.br/estatisticas/sociais/habitacao/38734-cadastro-
--     nacional-de-enderecos-para-fins-estatisticos.html — dado público,
--     coletado porta a porta pelo Censo).
--
--     Por que isso existe: geocodificação gratuita baseada só no
--     OpenStreetMap (Photon, usado no resto do app) não tem o número exato
--     da maioria dos endereços fora de áreas centrais bem mapeadas. Esta
--     tabela cobre isso pra endereços do Rio com dado real de censo — usada
--     como PRIMEIRA tentativa em geocoding.js antes de cair no Photon.
--
--     Esta tabela só tem a ESTRUTURA — os dados de verdade (as linhas) vêm
--     de um import de CSV feito manualmente pelo painel do Supabase (Table
--     Editor -> Import data from CSV), não deste script. Ver instruções.
-- ============================================================================
create table if not exists public.enderecos_rio (
  id               bigint generated always as identity primary key,
  tipo_logradouro  text not null,
  nome_logradouro  text not null,
  numero           text not null,
  bairro           text,
  cep              text,
  lat              double precision not null,
  lng              double precision not null
);

create index if not exists idx_enderecos_rio_numero on public.enderecos_rio (numero);

-- pg_trgm: index eficiente pra busca "contém" (ilike '%nome%'), não só
-- "começa com". Necessário porque nome de rua no Brasil costuma ter um
-- título/honorífico opcional na frente ("Rua MAJOR Fulano") — quem busca
-- pode digitar só o nome, sem o título, então geocoding.js procura por
-- "contém", não só por prefixo (ver buscarNoCnefeRio/consultarEnderecosRio).
create extension if not exists "pg_trgm";
create index if not exists idx_enderecos_rio_nome_trgm on public.enderecos_rio using gin (nome_logradouro gin_trgm_ops);

alter table public.enderecos_rio enable row level security;

-- Dado de referência público (vem do Censo do IBGE, não é conteúdo de
-- usuária) — qualquer pessoa logada pode ler; ninguém escreve pelo app
-- (a carga é feita só pelo painel do Supabase, uma vez).
drop policy if exists "enderecos_rio_leitura" on public.enderecos_rio;
create policy "enderecos_rio_leitura"
  on public.enderecos_rio for select
  to authenticated
  using (true);


-- ============================================================================
-- 16. TABELA: external_incidents — eventos/estatísticas vindos de fontes
--     PÚBLICAS (ex.: notícia) ou de DADOS OFICIAIS — nunca digitados por uma
--     usuária (isso continua sendo a tabela `reports`, sem duplicar nada
--     aqui). Populada só pela Edge Function `coletar-fontes` — ver
--     supabase/functions/coletar-fontes/index.ts e COMO_CONFIGURAR_COLETA_RJ.md.
--
--     Por que esta tabela existe separada de `reports`: cruzar relato de
--     usuária com fonte externa exige saber, célula por célula, o que veio
--     de onde — nunca misturar "o que a IA interpretou de uma notícia" com
--     "o que uma pessoa relatou de verdade" na mesma linha sem dizer qual é
--     qual (é a mesma razão de `posts` e `reports` já serem tabelas
--     diferentes hoje, mesmo sendo os dois "conteúdo com localização").
--
--     `matched_report_id`: preenchido quando a Edge Function encontra um
--     relato de usuária que parece ser o mesmo acontecimento — é o que faz
--     o mapa mostrar "confirmado pela comunidade" numa notícia.
--     `duplicate_of`: preenchido quando dois itens da mesma fonte (ou de
--     fontes diferentes) parecem ser a mesma notícia republicada — evita
--     contar cópia da mesma notícia como duas fontes independentes.
--
--     Só a Edge Function grava aqui, usando a service_role key (que ignora
--     RLS) — de propósito NÃO existe policy de insert/update/delete para
--     `authenticated`: ninguém publica isso pelo app, só a coleta automática.
--     Mesmo padrão de `enderecos_rio` (tabela 15): só leitura pelo app.
-- ============================================================================
create table if not exists public.external_incidents (
  id                uuid primary key default gen_random_uuid(),
  source_type       text not null check (source_type in ('public_source', 'official_data')),
  source            text not null,              -- identifica o adaptador, ex.: 'g1_rio_rss'
  source_url        text,
  source_id         text not null,              -- chave da própria fonte (guid da notícia etc.) — evita reprocessar
  event_type        text not null check (event_type in ('event', 'statistic')),
  -- "geral": notícia local do RJ sem relação com segurança (serviço
  -- público, clima, evento etc.) — existe só pra alimentar a aba "Notícias
  -- externas" da Comunidade; o Mapa (Tela 1) nunca mostra pino dessa
  -- categoria (ver filtro em js/map.js, carregarDadosDaAreaVisivel), pra
  -- não misturar notícia geral com ocorrência de segurança no mesmo lugar.
  category          text not null check (category in (
                      'assedio_verbal', 'assedio_fisico', 'assalto', 'perseguicao',
                      'rua_pouco_iluminada', 'local_isolado', 'acidente', 'bloqueio',
                      'obra', 'tiroteio', 'geral', 'outro'
                    )),
  title             text not null,
  description       text,
  state             text,
  city              text,
  neighborhood      text,
  address           text,
  lat               double precision,
  lng               double precision,
  occurred_at       timestamptz,
  published_at      timestamptz,
  collected_at      timestamptz not null default now(),
  expires_at        timestamptz,
  confidence        numeric not null default 0,
  -- pending: acabou de entrar, ainda não decidido se aparece no mapa.
  -- active/confirmed: aparece no mapa (confirmed = tem relato de usuária batendo).
  -- disputed: fontes se contradizem — precisa de revisão antes de confiar.
  -- expired: passou da validade (ver expires_at); rejected: descartado (fora do RJ etc.).
  status            text not null default 'pending' check (status in (
                      'pending', 'active', 'confirmed', 'disputed', 'expired', 'rejected'
                    )),
  ai_processed      boolean not null default false,
  needs_review      boolean not null default false,
  raw_data          jsonb,
  matched_report_id uuid references public.reports(id) on delete set null,
  duplicate_of      uuid references public.external_incidents(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists idx_external_incidents_status  on public.external_incidents(status);
create index if not exists idx_external_incidents_lat_lng on public.external_incidents(lat, lng);
create index if not exists idx_external_incidents_expires on public.external_incidents(expires_at);

drop trigger if exists trg_external_incidents_updated_at on public.external_incidents;
create trigger trg_external_incidents_updated_at
  before update on public.external_incidents
  for each row execute function public.set_updated_at();

alter table public.external_incidents enable row level security;

drop policy if exists "incidentes_externos_leitura" on public.external_incidents;
create policy "incidentes_externos_leitura"
  on public.external_incidents for select
  to authenticated
  using (status in ('active', 'confirmed'));

-- MIGRAÇÃO: mesmo motivo do "reports_type_check" lá em cima — "create table
-- if not exists" não altera uma tabela que já existe. Adiciona as categorias
-- "tiroteio" (antes, todo tiroteio/disparo de arma vinha classificado como
-- "assalto" por falta de categoria própria) e "geral" (notícia local do RJ
-- sem relação com segurança, só pra aba "Notícias externas" da Comunidade
-- — ver PROMPT_SISTEMA em coletar-fontes/index.ts). Não apaga nem invalida
-- nenhuma linha já gravada.
alter table public.external_incidents drop constraint if exists external_incidents_category_check;
alter table public.external_incidents add constraint external_incidents_category_check check (category in (
  'assedio_verbal', 'assedio_fisico', 'assalto', 'perseguicao',
  'rua_pouco_iluminada', 'local_isolado', 'acidente', 'bloqueio',
  'obra', 'tiroteio', 'geral', 'outro'
));


-- ============================================================================
-- 17. TABELA: report_votes (validação da comunidade: "concordo"/"discordo")
--     Cada relato mostra uma porcentagem de "quão certeiro" ele parece, com
--     base em quantas pessoas concordam com ele — mesmo espírito de
--     post_likes (tabela 9), mas com DOIS lados em vez de só "curtir": 1 voto
--     por pessoa por relato, pode trocar de lado a qualquer momento, ou tirar
--     o voto por completo (delete). Contadores em `reports` sincronizados por
--     gatilho — nunca calculados no client (evitaria 100 queries extras só
--     pra montar a lista).
-- ============================================================================
create table if not exists public.report_votes (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  vote       text not null check (vote in ('concordo', 'discordo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, user_id)
);

create index if not exists idx_report_votes_report on public.report_votes(report_id);
create index if not exists idx_report_votes_user    on public.report_votes(user_id);

drop trigger if exists trg_report_votes_updated_at on public.report_votes;
create trigger trg_report_votes_updated_at
  before update on public.report_votes
  for each row execute function public.set_updated_at();

-- "create table if not exists" acima não adiciona coluna nova a uma tabela
-- "reports" que já existia antes deste recurso — por isso o "add column if
-- not exists" separado aqui, idempotente e seguro de rodar de novo.
alter table public.reports add column if not exists agrees_count    integer not null default 0;
alter table public.reports add column if not exists disagrees_count integer not null default 0;

-- Mantém reports.agrees_count/disagrees_count sempre corretos, inclusive
-- quando a pessoa TROCA de voto (post_likes só trata insert/delete porque
-- curtida não tem "lado" pra trocar — voto tem, por isso soma o caso UPDATE).
create or replace function public.sync_report_votes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if (new.vote = 'concordo') then
      update public.reports set agrees_count = agrees_count + 1 where id = new.report_id;
    else
      update public.reports set disagrees_count = disagrees_count + 1 where id = new.report_id;
    end if;
    return new;
  elsif (tg_op = 'UPDATE') then
    if (old.vote <> new.vote) then
      if (new.vote = 'concordo') then
        update public.reports set
          agrees_count = agrees_count + 1,
          disagrees_count = greatest(disagrees_count - 1, 0)
        where id = new.report_id;
      else
        update public.reports set
          disagrees_count = disagrees_count + 1,
          agrees_count = greatest(agrees_count - 1, 0)
        where id = new.report_id;
      end if;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if (old.vote = 'concordo') then
      update public.reports set agrees_count = greatest(agrees_count - 1, 0) where id = old.report_id;
    else
      update public.reports set disagrees_count = greatest(disagrees_count - 1, 0) where id = old.report_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_report_votes_sync on public.report_votes;
create trigger trg_report_votes_sync
  after insert or update or delete on public.report_votes
  for each row execute function public.sync_report_votes_count();

alter table public.report_votes enable row level security;

-- Leitura liberada a qualquer authenticated (mesmo padrão de post_likes):
-- precisa ver o voto de TODO MUNDO pra saber se a usuária atual já votou e
-- destacar o botão certo, não só o próprio voto.
drop policy if exists "report_votes_leitura" on public.report_votes;
create policy "report_votes_leitura"
  on public.report_votes for select
  to authenticated
  using (true);

drop policy if exists "report_votes_insert_proprio" on public.report_votes;
create policy "report_votes_insert_proprio"
  on public.report_votes for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "report_votes_update_proprio" on public.report_votes;
create policy "report_votes_update_proprio"
  on public.report_votes for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "report_votes_delete_proprio" on public.report_votes;
create policy "report_votes_delete_proprio"
  on public.report_votes for delete
  to authenticated using (auth.uid() = user_id);


-- ============================================================================
-- 17.1 TABELA: report_flags ("denunciar informação falsa")
--      Diferente de report_votes acima (que é "concordo/discordo", uma
--      opinião leve sobre o relato): aqui a usuária está dizendo que ACHA que
--      o relato é falso ou malicioso — sinal mais forte, usado só pra decidir
--      quando um relato precisa de uma segunda olhada humana. 1 denúncia por
--      pessoa por relato (pode desfazer clicando de novo — mesmo padrão de
--      report_votes).
--
--      `reports.verification_status` é uma coisa DIFERENTE de
--      `reports.status` (seção 5: moderação, pending/approved/rejected, que
--      decide SE o relato é público). Aqui decide o quanto confiar nele
--      DEPOIS de já estar público:
--        nao_verificado -> estado inicial de todo relato aprovado.
--        em_analise     -> virou sozinho quando denúncias acumuladas passam
--                          de um limiar (ver sync_report_flags_count abaixo).
--        verificado     -> SEM gatilho automático ainda — existe no banco e
--                          já aparece na tela, pronto pro dia em que houver
--                          uma fonte de corroboração (cruzamento com fonte
--                          externa) ou confirmação manual de uma moderadora.
--                          Não implementado agora de propósito (ver conversa
--                          do dia 2026-10-21): validação por IA e cruzamento
--                          com o Instituto Fogo Cruzado ficaram pro roadmap,
--                          arriscado demais integrar horas antes de uma
--                          apresentação ao vivo.
-- ============================================================================
create table if not exists public.report_flags (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

create index if not exists idx_report_flags_report on public.report_flags(report_id);
create index if not exists idx_report_flags_user    on public.report_flags(user_id);

alter table public.reports add column if not exists flags_count integer not null default 0;
alter table public.reports add column if not exists verification_status text
  not null default 'nao_verificado'
  check (verification_status in ('nao_verificado','em_analise','verificado'));

create or replace function public.sync_report_flags_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.reports set
      flags_count = flags_count + 1,
      -- Só AVANÇA pra "em_analise" ao cruzar o limiar — nunca volta sozinha
      -- pra "nao_verificado" se uma denúncia for desfeita depois (um relato
      -- que já precisou de atenção continua precisando, mesmo que uma
      -- denúncia isolada seja retirada).
      verification_status = case
        when verification_status = 'nao_verificado' and flags_count + 1 >= 3 then 'em_analise'
        else verification_status
      end
    where id = new.report_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.reports set flags_count = greatest(flags_count - 1, 0) where id = old.report_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_report_flags_sync on public.report_flags;
create trigger trg_report_flags_sync
  after insert or delete on public.report_flags
  for each row execute function public.sync_report_flags_count();

alter table public.report_flags enable row level security;

-- Leitura liberada a qualquer authenticated (mesmo padrão de report_votes):
-- precisa saber se a própria usuária já denunciou, pra destacar o botão.
drop policy if exists "report_flags_leitura" on public.report_flags;
create policy "report_flags_leitura"
  on public.report_flags for select
  to authenticated
  using (true);

-- "with check" impede duas coisas ao mesmo tempo: denunciar em nome de outra
-- pessoa (auth.uid() = user_id) e denunciar o PRÓPRIO relato (subconsulta).
drop policy if exists "report_flags_insert_proprio" on public.report_flags;
create policy "report_flags_insert_proprio"
  on public.report_flags for insert
  to authenticated with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "report_flags_delete_proprio" on public.report_flags;
create policy "report_flags_delete_proprio"
  on public.report_flags for delete
  to authenticated using (auth.uid() = user_id);


-- ============================================================================
-- 18. TABELA: push_subscriptions (alertas proativos de segurança perto de você)
--     Diferente de tudo que existe até aqui, isso não é consultado pelo
--     app quando VOCÊ abre uma tela — é o INVERSO: quando um relato novo é
--     aprovado, ou uma notícia pública vira `active`/`confirmed`, o Supabase
--     chama sozinho a Edge Function `enviar-alerta-proximidade` (via
--     Database Webhook, configurado no Dashboard — ver
--     COMO_CONFIGURAR_ALERTAS.md, não dá pra fazer isso só com SQL), que
--     avisa por notificação push quem estiver com alerta ligado perto
--     daquele ponto — mesmo com o site fechado.
--
--     `lat`/`lng`/`raio_m`: a "área de interesse" de cada pessoa — hoje é
--     sempre a última localização conhecida dela (atualizada sempre que
--     liga o alerta ou abre o Mapa com o alerta já ligado), não um
--     rastreamento contínuo em segundo plano (navegador nenhum permite
--     geolocalização em segundo plano de verdade pra um site).
--
--     `endpoint`/`p256dh`/`auth`: dados técnicos da assinatura Web Push do
--     navegador (não são senha nem chave nossa) — únicos por navegador/
--     aparelho, é o que a Edge Function usa pra endereçar a notificação.
--
--     Só a própria pessoa mexe na própria assinatura pelo app; só a Edge
--     Function (service_role, ignora RLS) lê TODAS as linhas pra achar
--     quem está perto de um novo relato/notícia.
-- ============================================================================
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  lat        double precision,
  lng        double precision,
  raio_m     integer not null default 1500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user     on public.push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_lat_lng  on public.push_subscriptions(lat, lng);

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_proprio" on public.push_subscriptions;
create policy "push_subscriptions_select_proprio"
  on public.push_subscriptions for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_proprio" on public.push_subscriptions;
create policy "push_subscriptions_insert_proprio"
  on public.push_subscriptions for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_proprio" on public.push_subscriptions;
create policy "push_subscriptions_update_proprio"
  on public.push_subscriptions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_proprio" on public.push_subscriptions;
create policy "push_subscriptions_delete_proprio"
  on public.push_subscriptions for delete
  to authenticated using (auth.uid() = user_id);


-- ============================================================================
-- 19. TABELA: monitored_trips ("Acompanhar corrida" — Uber/99, Tela 2)
--     Não lê o GPS de dentro do Uber/99 (não existe API pública pra isso) —
--     a usuária cola o link de "compartilhar corrida" que o próprio app dela
--     já gera, e define um horário esperado de chegada. A Edge Function
--     `verificar-corridas` (agendada por pg_cron, mesmo padrão de
--     `coletar-fontes` — ver COMO_CONFIGURAR_ALERTAS.md) varre esta tabela
--     periodicamente e manda um lembrete por push quando o prazo vence sem
--     `confirmed_at` preenchido, escalando pra um aviso mais urgente se ainda
--     assim não houver confirmação. IMPORTANTE: isso é uma camada de
--     lembrete/tranquilidade, nunca um substituto de ligar pra 190 — o app
--     não tem como avisar o contato de emergência sozinho (ele não é
--     usuária do app, não tem push subscription), só lembrar A PRÓPRIA
--     usuária de fazer isso com um toque (ver js/emergency.js,
--     obterLinkDeConfirmacaoAtrasada).
-- ============================================================================
create table if not exists public.monitored_trips (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  -- Opcional: a Tela 2 deixou de EXIGIR link de carona por app (Uber/99) —
  -- "Acompanhar trajeto" também serve pra quem só está andando sozinha até
  -- algum lugar, sem corrida nenhuma pra colar o link. Null = não tinha link
  -- (ou foi um trajeto a pé) — ver js/carona.js.
  share_link           text,
  destino_texto        text not null,
  expected_arrival_at  timestamptz not null,
  confirmed_at         timestamptz,
  reminder_sent_at     timestamptz,
  escalated_at         timestamptz,
  status               text not null default 'ativa' check (status in (
                         'ativa', 'confirmada', 'escalada', 'encerrada_manual'
                       )),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_monitored_trips_status_prazo
  on public.monitored_trips(status, expected_arrival_at);

drop trigger if exists trg_monitored_trips_updated_at on public.monitored_trips;
create trigger trg_monitored_trips_updated_at
  before update on public.monitored_trips
  for each row execute function public.set_updated_at();

alter table public.monitored_trips enable row level security;

-- 100% privado, mesmo padrão de emergency_contacts — só a própria usuária lê/
-- escreve pelo app; a Edge Function de checagem usa a service_role key (que
-- ignora RLS) pra varrer as corridas de todo mundo.
drop policy if exists "corridas_proprias_select" on public.monitored_trips;
create policy "corridas_proprias_select"
  on public.monitored_trips for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "corridas_proprias_insert" on public.monitored_trips;
create policy "corridas_proprias_insert"
  on public.monitored_trips for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "corridas_proprias_update" on public.monitored_trips;
create policy "corridas_proprias_update"
  on public.monitored_trips for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- MIGRAÇÃO: quem já tinha monitored_trips criada antes do link virar opcional
-- (ver comentário na coluna acima) — "create table if not exists" não altera
-- uma tabela que já existe. Rodar de novo numa coluna que já é opcional não
-- dá erro (é idempotente).
alter table public.monitored_trips alter column share_link drop not null;


-- ============================================================================
-- 20. TABELA + FUNÇÃO: rate_limits (limite de chamadas por usuária)
--     `perguntar-vanessa` e `calcular-rota` são chamadas direto pelo navegador
--     de uma usuária logada (sem secret próprio, só o JWT padrão do Supabase)
--     e repassam cota de nível gratuito de terceiros (Gemini/OpenRouteService).
--     Esta tabela guarda, por usuária e por função, quantas chamadas
--     aconteceram na janela de tempo atual — não é dado da usuária, é só
--     controle interno, por isso não tem policy pra `authenticated` (só a
--     própria Edge Function, com a service_role key, mexe aqui).
-- ============================================================================
create table if not exists public.rate_limits (
  user_id       uuid not null references auth.users(id) on delete cascade,
  funcao        text not null,
  janela_inicio timestamptz not null default now(),
  contagem      int not null default 1,
  primary key (user_id, funcao)
);

alter table public.rate_limits enable row level security;

-- Checa-e-incrementa atômico: um UPSERT só, sem select-depois-update (que
-- teria uma brecha de corrida entre duas chamadas simultâneas da mesma
-- usuária). Se a janela anterior já venceu, reinicia a contagem em 1 em vez
-- de simplesmente somar. Devolve true (permitido) ou false (estourou o
-- limite) — quem chama decide o que fazer com isso.
create or replace function public.verificar_limite_de_chamadas(
  p_user_id uuid,
  p_funcao text,
  p_limite int,
  p_janela_segundos int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contagem int;
begin
  insert into public.rate_limits (user_id, funcao, janela_inicio, contagem)
  values (p_user_id, p_funcao, now(), 1)
  on conflict (user_id, funcao) do update set
    contagem = case
      when public.rate_limits.janela_inicio < now() - make_interval(secs => p_janela_segundos)
        then 1
      else public.rate_limits.contagem + 1
    end,
    janela_inicio = case
      when public.rate_limits.janela_inicio < now() - make_interval(secs => p_janela_segundos)
        then now()
      else public.rate_limits.janela_inicio
    end
  returning contagem into v_contagem;

  return v_contagem <= p_limite;
end;
$$;


-- ============================================================================
-- 21. reports.bairro — resolvido UMA VEZ no cadastro (js/reports.js), nunca
--     mais recalculado toda vez que alguém abre o Observatório. Antes disso,
--     cada abertura da tela chamava geocodificação reversa (Photon) ao vivo
--     pra cada relato — lento (15s+ com vários relatos) e dependente do
--     Photon estar disponível bem naquele instante pra TODO MUNDO que
--     abrisse a tela, não só pra quem cadastrou. Null = ainda não resolvido
--     (relato cadastrado antes desta coluna existir, ou o Photon falhou na
--     hora do cadastro) — esses relatos simplesmente não entram nos
--     gráficos por região do Observatório até alguém rodar uma correção
--     manual (poucos relatos hoje, não precisa de automação pra isso).
-- ============================================================================
alter table public.reports add column if not exists bairro text;

-- ============================================================================
-- FIM. Se rodou sem erro, você verá "Success. No rows returned".
-- ============================================================================
