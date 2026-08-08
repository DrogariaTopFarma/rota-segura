-- ============================================================
-- ROTA SEGURA — SCHEMA DO BANCO DE DADOS (Supabase / PostgreSQL)
-- ============================================================
-- Como usar: Supabase → seu projeto → SQL Editor → New query →
-- cole este arquivo inteiro → Run.
-- ============================================================

-- Extensão para gerar UUIDs
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) PERFIS — dados públicos/privados de cada usuária.
--    A autenticação (senha, e-mail, hash) é gerenciada pelo
--    Supabase Auth em auth.users. Esta tabela guarda o que é
--    específico do nosso app: nome, contato de emergência.
-- ------------------------------------------------------------
create table public.perfis (
  id uuid references auth.users(id) on delete cascade primary key,
  nome text not null,
  email text not null,
  contato_emergencia text not null, -- telefone/WhatsApp em formato internacional, ex: 5521999999999
  created_at timestamptz default now()
);

alter table public.perfis enable row level security;

-- Cada usuária só enxerga e edita o PRÓPRIO perfil.
-- Isso é proposital: o contato de emergência é um dado sensível
-- e não deve ficar público para as demais usuárias do app.
create policy "Usuaria le o proprio perfil"
  on public.perfis for select
  using (auth.uid() = id);

create policy "Usuaria cria o proprio perfil"
  on public.perfis for insert
  with check (auth.uid() = id);

create policy "Usuaria atualiza o proprio perfil"
  on public.perfis for update
  using (auth.uid() = id);


-- ------------------------------------------------------------
-- 2) LOCAIS — pontos cadastrados no mapa.
--    local_key agrupa cadastros do "mesmo lugar" (nome + bairro
--    normalizados) para a lógica de "mostrar só o mais recente".
-- ------------------------------------------------------------
create table public.locais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  bairro text not null,
  categoria text not null check (categoria in ('rua','estabelecimento','onibus','estacao')),
  nivel_seguranca text not null check (nivel_seguranca in ('seguro','atencao','alerta')),
  descricao text,
  latitude double precision not null,
  longitude double precision not null,
  local_key text not null,
  autor_id uuid references auth.users(id),
  autor_nome text,
  created_at timestamptz default now()
);

create index locais_local_key_idx on public.locais (local_key, created_at desc);

alter table public.locais enable row level security;

-- Leitura liberada para qualquer usuária autenticada no app
-- (o app inteiro fica atrás de login — ver auth.js).
create policy "Autenticadas leem locais"
  on public.locais for select
  using (auth.role() = 'authenticated');

create policy "Autenticadas cadastram locais"
  on public.locais for insert
  with check (auth.uid() = autor_id);

create policy "Autora edita seus locais"
  on public.locais for update
  using (auth.uid() = autor_id);

create policy "Autora apaga seus locais"
  on public.locais for delete
  using (auth.uid() = autor_id);


-- ------------------------------------------------------------
-- 3) COMUNIDADE_POSTS — fórum/chat de relatos e avisos.
-- ------------------------------------------------------------
create table public.comunidade_posts (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid references auth.users(id),
  autor_nome text not null,
  tipo text not null check (tipo in ('relato','duvida','aviso')) default 'relato',
  conteudo text not null,
  created_at timestamptz default now()
);

alter table public.comunidade_posts enable row level security;

create policy "Autenticadas leem a comunidade"
  on public.comunidade_posts for select
  using (auth.role() = 'authenticated');

create policy "Autenticadas postam na comunidade"
  on public.comunidade_posts for insert
  with check (auth.uid() = autor_id);

create policy "Autora apaga a propria mensagem"
  on public.comunidade_posts for delete
  using (auth.uid() = autor_id);


-- ------------------------------------------------------------
-- 4) REALTIME — liga as tabelas ao canal de tempo real do
--    Supabase, usado pelo chat da comunidade e pela atualização
--    automática do mapa quando alguém cadastra um novo local.
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.comunidade_posts;
alter publication supabase_realtime add table public.locais;
