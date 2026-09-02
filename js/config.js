/* ============================================================================
   ROTA SEGURA — CONFIGURAÇÃO
   ----------------------------------------------------------------------------
   ESTE É O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR PARA O APP FUNCIONAR.

   Troque os dois valores abaixo pelos dados do SEU projeto Supabase.
   Onde achar: painel do Supabase -> ícone de engrenagem "Project Settings"
   -> "API Keys" / "Data API". Veja o passo a passo no GUIA_PASSO_A_PASSO.md.

   IMPORTANTE SOBRE SEGURANÇA:
   A chave "anon" (publishable) foi feita para ficar visível no navegador.
   Ela sozinha não dá acesso a nada: quem protege os dados é o Row Level
   Security (RLS) que você criou no SQL.
   NUNCA coloque aqui a chave "service_role" (secret). Essa ignora o RLS.
   ============================================================================ */

export const SUPABASE_URL = 'https://rmggyqqmhupkabgwmnzv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ZBpUZp9ZqjvnKMU0lNky_Q_poX_2huA';

// Chave PÚBLICA do VAPID (alertas de segurança por notificação push) — assim
// como a anon key acima, foi feita pra ficar visível no navegador; é a
// contraparte da VAPID_PRIVATE_KEY, que fica só como secret da Edge Function
// `enviar-alerta-proximidade` (nunca aqui). Ver COMO_CONFIGURAR_ALERTAS.md.
export const VAPID_PUBLIC_KEY = 'BPtuvvldLgDai3ervwpJ7lJ349s9rOggI2nVaq8Uul8fvDeMhibxE8yMy_81XLhk3najJlvYvuwV-k3aIlvyBio';

// Chave da CARTO (o mapa base que aparece por trás de tudo) — a CARTO passou
// a exigir essa chave nos tiles de basemaps.cartocdn.com; sem ela, o mapa
// mostra ladrilhos com o aviso "API KEY REQUIRED" em vez do mapa de verdade.
// É gratuita e instantânea: https://carto.com/basemaps/apikey -> preencha o
// formulário na própria página (e-mail, domínio onde o site vai rodar, e uma
// frase descrevendo o projeto) -> a chave chega na hora, sem fila de espera.
// Assim como a anon key acima, ela É feita pra ficar visível no navegador
// (o Leaflet carrega os tiles direto do navegador da usuária, não tem como
// esconder) — quem limita o uso indevido é a CARTO, pelo domínio cadastrado
// e pelo limite do plano gratuito (5 milhões de tiles/mês).
export const CARTO_API_KEY = 'cb1_2rcb_1_702c9ede22412071aa79779c';

/* Configurações gerais do app (pode deixar como está) */
export const APP_CONFIG = {
  // Centro inicial do mapa se o GPS for negado (Rio de Janeiro)
  centroPadrao: [-22.9068, -43.1729],
  zoomPadrao: 14,
  zoomBusca: 16,
  // Zoom usado no mini-mapa dos formulários (bem perto, para acertar a porta)
  zoomSeletor: 17,
  // Zoom usado durante a navegação ativa (Tela 2) — bem mais perto que o
  // seletor de endereço, pra ficar no estilo Google Maps/Waze (só o
  // quarteirão à frente, não o bairro inteiro). 20 é o máximo que os tiles
  // do mapa aceitam de verdade (maxZoom 20 em routes.js, testado ao vivo
  // contra o servidor de tiles — não dá pra subir mais que isso).
  zoomNavegacao: 20,
  // Raio (em metros) usado para contar relatos perto de um endereço pesquisado
  raioBuscaMetros: 500,
  // Tempo de espera antes de disparar a busca enquanto você digita (ms)
  debounceMs: 500
};
