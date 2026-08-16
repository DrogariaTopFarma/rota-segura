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

/* Configurações gerais do app (pode deixar como está) */
export const APP_CONFIG = {
  // Centro inicial do mapa se o GPS for negado (Rio de Janeiro)
  centroPadrao: [-22.9068, -43.1729],
  zoomPadrao: 14,
  zoomBusca: 16,
  // Zoom usado no mini-mapa dos formulários (bem perto, para acertar a porta)
  zoomSeletor: 17,
  // Raio (em metros) usado para contar relatos perto de um endereço pesquisado
  raioBuscaMetros: 500,
  // Tempo de espera antes de disparar a busca enquanto você digita (ms)
  debounceMs: 500,
  // E-mail de contato usado no cabeçalho das chamadas ao Nominatim
  contatoNominatim: 'rota-segura-app'
};
