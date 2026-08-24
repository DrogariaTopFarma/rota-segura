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
