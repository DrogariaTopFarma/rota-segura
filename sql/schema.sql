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
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

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

create index if not exists idx_posts_status     on public.posts(status);
create index if not exists idx_posts_created_at on public.posts(created_at desc);
create index if not exists idx_posts_user       on public.posts(user_id);

drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();


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
drop policy if exists "relatos_leitura" on public.reports;
create policy "relatos_leitura"
  on public.reports for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

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

drop policy if exists "pontos_insert_proprio" on public.support_points;
create policy "pontos_insert_proprio"
  on public.support_points for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "pontos_update_proprio" on public.support_points;
create policy "pontos_update_proprio"
  on public.support_points for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "pontos_delete_proprio" on public.support_points;
create policy "pontos_delete_proprio"
  on public.support_points for delete
  to authenticated using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 12.5 police_stations
-- ---------------------------------------------------------------------------
drop policy if exists "delegacias_leitura" on public.police_stations;
create policy "delegacias_leitura"
  on public.police_stations for select
  to authenticated
  using (status = 'approved' or auth.uid() = user_id);

drop policy if exists "delegacias_insert_proprio" on public.police_stations;
create policy "delegacias_insert_proprio"
  on public.police_stations for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "delegacias_update_proprio" on public.police_stations;
create policy "delegacias_update_proprio"
  on public.police_stations for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delegacias_delete_proprio" on public.police_stations;
create policy "delegacias_delete_proprio"
  on public.police_stations for delete
  to authenticated using (auth.uid() = user_id);


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
-- FIM. Se rodou sem erro, você verá "Success. No rows returned".
-- ============================================================================
