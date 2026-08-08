-- ============================================================
-- ROTA SEGURA — SCHEMA DO BANCO DE DADOS (Supabase / PostgreSQL)
-- Versão 2 — inclui: periodo/anônimo em locais, instituições
-- (delegacias e pontos de apoio) e votos de validação comunitária.
-- ============================================================
-- INSTALAÇÃO NOVA (banco vazio): rode este arquivo inteiro.
-- JÁ RODOU A VERSÃO 1 ANTES? Rode sql/migration_v2.sql em vez
-- deste (ele só adiciona o que falta, sem apagar dados).
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) PERFIS
-- ------------------------------------------------------------
create table public.perfis (
  id uuid references auth.users(id) on delete cascade primary key,
  nome text not null,
  email text not null,
  contato_emergencia text not null,
  created_at timestamptz default now()
);

alter table public.perfis enable row level security;

create policy "Usuaria le o proprio perfil"
  on public.perfis for select using (auth.uid() = id);
create policy "Usuaria cria o proprio perfil"
  on public.perfis for insert with check (auth.uid() = id);
create policy "Usuaria atualiza o proprio perfil"
  on public.perfis for update using (auth.uid() = id);


-- ------------------------------------------------------------
-- 2) LOCAIS — relatos cadastrados no mapa.
--    periodo: horário do OCORRIDO (não da postagem), usado no
--    filtro "Manhã/Tarde/Noite/Madrugada".
--    anonimo: quando true, o app oculta autor_nome na interface.
-- ------------------------------------------------------------
create table public.locais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  bairro text not null,
  categoria text not null check (categoria in ('rua','estabelecimento','onibus','estacao')),
  nivel_seguranca text not null check (nivel_seguranca in ('seguro','atencao','alerta')),
  periodo text not null check (periodo in ('manha','tarde','noite','madrugada')) default 'tarde',
  descricao text,
  latitude double precision not null,
  longitude double precision not null,
  local_key text not null,
  anonimo boolean not null default false,
  autor_id uuid references auth.users(id),
  autor_nome text,
  created_at timestamptz default now()
);

create index locais_local_key_idx on public.locais (local_key, created_at desc);

alter table public.locais enable row level security;

create policy "Autenticadas leem locais"
  on public.locais for select using (auth.role() = 'authenticated');
create policy "Autenticadas cadastram locais"
  on public.locais for insert with check (auth.uid() = autor_id);
create policy "Autora edita seus locais"
  on public.locais for update using (auth.uid() = autor_id);
create policy "Autora apaga seus locais"
  on public.locais for delete using (auth.uid() = autor_id);


-- ------------------------------------------------------------
-- 3) COMUNIDADE_POSTS — Mural de Avisos (feed em tempo real).
-- ------------------------------------------------------------
create table public.comunidade_posts (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid references auth.users(id),
  autor_nome text not null,
  tipo text not null check (tipo in ('relato','duvida','aviso')) default 'relato',
  conteudo text not null,
  anonimo boolean not null default false,
  created_at timestamptz default now()
);

alter table public.comunidade_posts enable row level security;

create policy "Autenticadas leem a comunidade"
  on public.comunidade_posts for select using (auth.role() = 'authenticated');
create policy "Autenticadas postam na comunidade"
  on public.comunidade_posts for insert with check (auth.uid() = autor_id);
create policy "Autora apaga a propria mensagem"
  on public.comunidade_posts for delete using (auth.uid() = autor_id);


-- ------------------------------------------------------------
-- 4) INSTITUICOES — Delegacias da Mulher (DEAM) e Pontos de
--    Apoio da Rede Amiga (farmácias 24h, comércios parceiros...).
-- ------------------------------------------------------------
create table public.instituicoes (
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

create policy "Autenticadas leem instituicoes"
  on public.instituicoes for select using (auth.role() = 'authenticated');
create policy "Autenticadas cadastram instituicoes"
  on public.instituicoes for insert with check (auth.uid() = autor_id);
create policy "Autora edita suas instituicoes"
  on public.instituicoes for update using (auth.uid() = autor_id);
create policy "Autora apaga suas instituicoes"
  on public.instituicoes for delete using (auth.uid() = autor_id);


-- ------------------------------------------------------------
-- 5) LOCAIS_VOTOS — validação comunitária ("Concordo" / "Não
--    concordo") de cada relato. Uma usuária só pode votar uma
--    vez por local (pode trocar o voto, não duplicar).
-- ------------------------------------------------------------
create table public.locais_votos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references public.locais(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  voto text not null check (voto in ('concordo','discordo')),
  created_at timestamptz default now(),
  unique (local_id, usuario_id)
);

alter table public.locais_votos enable row level security;

create policy "Autenticadas leem votos"
  on public.locais_votos for select using (auth.role() = 'authenticated');
create policy "Autenticadas votam"
  on public.locais_votos for insert with check (auth.uid() = usuario_id);
create policy "Usuaria troca o proprio voto"
  on public.locais_votos for update using (auth.uid() = usuario_id);
create policy "Usuaria apaga o proprio voto"
  on public.locais_votos for delete using (auth.uid() = usuario_id);


-- ------------------------------------------------------------
-- 6) REALTIME
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.comunidade_posts;
alter publication supabase_realtime add table public.locais;
alter publication supabase_realtime add table public.instituicoes;
alter publication supabase_realtime add table public.locais_votos;


-- ------------------------------------------------------------
-- 7) SEED OPCIONAL — exemplo de como cadastrar uma DEAM real.
--    Troque os dados e as coordenadas (pegue no Google Maps,
--    clique com o botão direito no ponto exato → copia as
--    coordenadas) e rode manualmente no SQL Editor.
-- ------------------------------------------------------------
-- insert into public.instituicoes (tipo, nome, endereco, telefone, latitude, longitude)
-- values ('delegacia', 'DEAM - Delegacia da Mulher', 'Rua Exemplo, 123 - Centro', '(21) 0000-0000', -22.9068, -43.1729);
