-- ============================================================
-- ROTA SEGURA — MIGRAÇÃO v1 → v2
-- Rode este arquivo se você JÁ tinha as tabelas perfis, locais e
-- comunidade_posts criadas (v1) e só quer adicionar as novidades:
-- período/anônimo, instituições (delegacias/pontos de apoio) e
-- votos de validação comunitária. Não apaga nenhum dado existente.
-- ============================================================

-- 1) Novas colunas em locais
alter table public.locais
  add column if not exists periodo text not null default 'tarde'
    check (periodo in ('manha','tarde','noite','madrugada')),
  add column if not exists anonimo boolean not null default false;

-- 2) Nova coluna em comunidade_posts
alter table public.comunidade_posts
  add column if not exists anonimo boolean not null default false;

-- 3) Tabela de instituições (delegacias e pontos de apoio)
create table if not exists public.instituicoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('delegacia','apoio')),
  nome text not null,
  endereco text,
  telefone text,
  latitude double precision not null,
  longitude double precision not null,
  autor_id uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table public.instituicoes enable row level security;

do $$ begin
  create policy "Autenticadas leem instituicoes"
    on public.instituicoes for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Autenticadas cadastram instituicoes"
    on public.instituicoes for insert with check (auth.uid() = autor_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Autora edita suas instituicoes"
    on public.instituicoes for update using (auth.uid() = autor_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Autora apaga suas instituicoes"
    on public.instituicoes for delete using (auth.uid() = autor_id);
exception when duplicate_object then null; end $$;

-- 4) Tabela de votos de validação comunitária
create table if not exists public.locais_votos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references public.locais(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  voto text not null check (voto in ('concordo','discordo')),
  created_at timestamptz default now(),
  unique (local_id, usuario_id)
);

alter table public.locais_votos enable row level security;

do $$ begin
  create policy "Autenticadas leem votos"
    on public.locais_votos for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Autenticadas votam"
    on public.locais_votos for insert with check (auth.uid() = usuario_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Usuaria troca o proprio voto"
    on public.locais_votos for update using (auth.uid() = usuario_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Usuaria apaga o proprio voto"
    on public.locais_votos for delete using (auth.uid() = usuario_id);
exception when duplicate_object then null; end $$;

-- 5) Realtime para as tabelas novas
do $$ begin
  alter publication supabase_realtime add table public.instituicoes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.locais_votos;
exception when duplicate_object then null; end $$;
