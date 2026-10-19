-- ============================================================================
-- ROTA SEGURA — Seed: pontos de ônibus do Rio de Janeiro (OpenStreetMap)
-- ----------------------------------------------------------------------------
-- 80 pontos de ônibus reais (nome + coordenada), extraídos ao vivo do
-- OpenStreetMap (Overpass API, highway=bus_stop, só os que já têm nome
-- mapeado) em 2026-10-18. Cobre várias regiões do Rio (Laranjeiras,
-- Botafogo, Copacabana, Ipanema, Tijuca, Madureira, Marechal Hermes,
-- Galeão, entre outras).
--
-- `extra_info` guarda as comodidades REAIS que o próprio OpenStreetMap já
-- tinha mapeado pra aquele ponto (shelter=cobertura, bench=banco, lit=
-- iluminação, tactile_paving=piso tátil) — nunca um ícone "adivinhado" pra
-- ponto que a fonte não tinha essa informação (por isso fica null em quase
-- metade das linhas: a ausência da tag não significa que o ponto não TEM a
-- comodidade, só que ninguém mapeou ainda — ver js/map.js, que só mostra o
-- ícone quando a flag existe de verdade).
--
-- IMPORTANTE: é dado da COMUNIDADE do OpenStreetMap, não uma lista oficial
-- da SMTR/GTFS — mesmo princípio já usado em seed_delegacias.sql. É real e
-- verificável, mas pode ter ponto desativado/renomeado. Cada linha já vem
-- com a fonte anotada no campo "description".
--
-- Fotos: NÃO ficam guardadas aqui — o popup do mapa busca ao vivo fotos
-- reais da vizinhança no Wikimedia Commons (ver js/wikimedia.js), pra nunca
-- guardar/curar uma foto que pode ficar errada ou desatualizada.
--
-- COMO USAR: SQL Editor do Supabase -> cole este arquivo inteiro -> Run.
-- É seguro rodar mais de uma vez? NÃO verifica duplicata — rode só uma vez.
-- Se já rodou a versão anterior deste arquivo (sem extra_info), apague as
-- 80 linhas de ponto_onibus antes (`delete from public.support_points where
-- type = 'ponto_onibus';`) e rode esta de novo, pra não duplicar.
-- ============================================================================

insert into public.support_points (type, name, lat, lng, description, extra_info, status)
values
  ('ponto_onibus', 'Rua Haniball Porto, 319 - 451', -22.825621, -43.325882, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes', 'approved'),
  ('ponto_onibus', 'Largo do Machado', -22.930960, -43.177550, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'Palácio Universitário', -22.952290, -43.173220, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Botafogo', -22.951055, -43.183294, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final: São Januário :: Linha 473', -22.891270, -43.229090, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final 439', -22.917040, -43.250331, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Rua Haanibal Porto, 797-899', -22.822302, -43.323509, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Vigilante Fortunato', -22.859643, -43.457691, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Ponto final 2342', -22.906903, -43.173713, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Ponto final 2343', -22.907006, -43.174043, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Shopping Rio Sul', -22.957437, -43.177157, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Cardeal Arcoverde', -22.964972, -43.180153, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'lit=yes', 'approved'),
  ('ponto_onibus', 'Roquete Pinto', -22.945170, -43.163320, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Instituto Benjamin Constant', -22.952992, -43.172436, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;tactile_paving=yes', 'approved'),
  ('ponto_onibus', 'Escola Municipal Minas Gerais', -22.953909, -43.168892, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Odílio Bacelar', -22.952662, -43.167455, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Joaquim Caetano', -22.945126, -43.161001, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Urbano Santos', -22.951982, -43.168558, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Praça Felix Laranjeiras', -22.953250, -43.168110, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final Linha(s): 107,513', -22.943325, -43.160943, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Roquete Pinto', -22.946825, -43.162107, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Instituto Benjamin Constant', -22.953031, -43.171702, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1,4 Praça Tiradentes', -22.907228, -43.182720, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes', 'approved'),
  ('ponto_onibus', 'Leroy Merlin', -22.993813, -43.365402, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Humaitá', -22.959724, -43.201256, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Maria Angélica', -22.960666, -43.206755, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Jardim Botânico', -22.964768, -43.217890, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'São Francisco Xavier', -22.918369, -43.224940, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Ponto Final: Saens Peña :: Linha 409', -22.931494, -43.234319, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'Martim Afonso', -22.962640, -43.166690, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2: Rainha Elizabeth', -22.985066, -43.190190, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Sá Ferreira', -22.980456, -43.191034, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 Djalma Ulrich', -22.979524, -43.190920, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Miguel Lemos', -22.978367, -43.190646, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 3 Bolivar', -22.976505, -43.190153, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Constante Ramos', -22.974342, -43.189026, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 Barão de Ipanema', -22.975266, -43.189627, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 Santa Clara', -22.972697, -43.187955, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Figueiredo Magalhães', -22.970684, -43.186332, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 Hilário de Gouveia', -22.968929, -43.184187, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 3 Siqueira Campos', -22.969625, -43.185111, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Paula Freitas', -22.968494, -43.183511, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 República do Peru', -22.967275, -43.181125, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 3 Fernando Mendes', -22.966845, -43.179730, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 Rodolfo Dantas', -22.966025, -43.178260, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'BRS 2 Belford Roxo', -22.964675, -43.175541, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final: Marechal Hermes :: Linha 928', -22.859788, -43.369540, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 784 Marechal Hermes >> Vila Kennedy', -22.861545, -43.369888, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 737 Marechal Hermes >> Santíssimo', -22.861617, -43.369761, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 786 Marechal Hermes >> Campo Grande', -22.860413, -43.372290, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 265 Marechal Hermes >> Praça XV', -22.857109, -43.366150, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 731 Campo Grande >> Marechal Hermes via Estr. da Posse', -22.861688, -43.369619, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 738 Marechal Hermes >> Urucânia', -22.860359, -43.372392, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 570P Marechal Hermes >> Itaguaí', -22.861738, -43.369506, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Montese', -22.860910, -43.371190, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;tactile_paving=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final: Marechal Hermes :: Linha 638', -22.853717, -43.376421, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Ponto Final: Madureira :: Linha 779', -22.876831, -43.337877, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'bench=yes', 'approved'),
  ('ponto_onibus', 'Linha 277 Rocha Miranda >> Praça XV', -22.860019, -43.354705, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 777 Madureira >> Padre Miguel', -22.870292, -43.340359, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'LInha 940 Madureira >> Ramos', -22.870197, -43.341823, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 774 Madureira >> Jardim América', -22.870341, -43.341983, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Linha 766 Madureira >> Freguesia', -22.869839, -43.340780, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'UNIRIO', -22.954220, -43.168580, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;tactile_paving=yes', 'approved'),
  ('ponto_onibus', 'BRS 1 - Rita Ludolf', -22.986048, -43.228083, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Ponto Final: Candelária :: Ônibus para Jacarepaguá', -22.901160, -43.177500, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Maria Amália', -22.927725, -43.239870, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'Conde de Bonfim', -22.931772, -43.241641, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;lit=yes', 'approved'),
  ('ponto_onibus', 'General Espírito Santo Cardoso', -22.929227, -43.243336, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Muda (Ponto Final)', -22.932004, -43.247112, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'General Roca', -22.925055, -43.233680, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Barão de Mesquita 482c', -22.924052, -43.241474, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'lit=yes', 'approved'),
  ('ponto_onibus', 'Ponto final da linha 932A', -22.958119, -43.352427, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'Terminal Arquiteto Julius Sass :: Plataforma B', -22.958240, -43.352153, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes', 'approved'),
  ('ponto_onibus', 'BRS 1/3 Teixeira de Melo', -22.985540, -43.199619, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Galeão - Tom Jobim 1', -22.811103, -43.251900, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Premium Auto Ônibus', -22.814464, -43.246544, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved'),
  ('ponto_onibus', 'Linha 21 de Abril', -22.794722, -43.328320, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'BRS 1/3 Pres. Antônio Carlos (Beira-Mar)', -22.910722, -43.170791, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'BRS 4/5 Pres. Antônio Carlos (Santa Luzia)', -22.908448, -43.172292, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', null, 'approved'),
  ('ponto_onibus', 'BRS 1/3 Pres. Antônio Carlos (Franklin Roosevelt)', -22.910300, -43.171775, 'Fonte: OpenStreetMap (dados abertos, comunidade) — confira antes de divulgar oficialmente.', 'shelter=yes;bench=yes', 'approved');
