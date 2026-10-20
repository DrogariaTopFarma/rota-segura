-- ============================================================================
-- ROTA SEGURA — Limpeza pontual dos dados de teste (antes do INOVATEC)
-- ----------------------------------------------------------------------------
-- Ao longo da sessão de testes, foram criadas ~70 contas descartáveis
-- (padrão teste.rotasegura.<numero>@mailinator.com, mesma senha de teste em
-- todas) pra verificar cada funcionalidade ao vivo. Isso deixou relato/
-- publicação de teste MISTURADO com o que é real no banco — hoje são 17 dos
-- 23 relatos aprovados e 7 das 14 publicações aprovadas (maioria é teste).
-- Rodando numa avaliação com gente de fora olhando, isso aparece como
-- "Teste 1", "Rua de teste, 123" etc. no Observatório e na Comunidade.
--
-- ESTE SCRIPT SÓ APAGA CONTA/CONTEÚDO COM O PADRÃO DE E-MAIL DE TESTE ACIMA —
-- nunca toca na sua conta real nem em dado de verdade. Seguro rodar mais de
-- uma vez (se não sobrar nenhuma conta de teste, simplesmente não apaga
-- nada na segunda vez).
--
-- COMO USAR: SQL Editor do Supabase -> cole este arquivo inteiro -> Run.
-- ============================================================================

-- 1) Pontos de apoio/delegacias de conta de teste (se houver) — essas duas
--    tabelas usam "on delete set null" no user_id, não "cascade", então
--    precisam ser apagadas ANTES do passo 2 (depois, o user_id já teria
--    virado null e não daria mais pra saber que era de teste).
delete from public.support_points
where user_id in (select id from auth.users where email ilike 'teste.rotasegura.%');

delete from public.police_stations
where user_id in (select id from auth.users where email ilike 'teste.rotasegura.%');

-- 2) A conta em si — isso sozinho já leva junto (cascade), automaticamente:
--    profiles, reports, posts (e post_likes/post_comments de cada post),
--    emergency_contacts, route_history, monitored_trips, push_subscriptions,
--    rate_limits e report_votes de cada uma dessas ~70 contas de teste.
delete from auth.users where email ilike 'teste.rotasegura.%';

-- ============================================================================
-- FIM. Confira o resultado: "Success. No rows returned" ou "X rows affected".
-- ============================================================================
