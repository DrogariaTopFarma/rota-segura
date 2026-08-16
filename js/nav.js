/* ============================================================================
   ROTA SEGURA — Bottom navigation e sino de notificações
   ============================================================================ */

import { supabase } from './supabase.js';
import { abrirModal } from './ui.js';

/** Marca como ativo o item da navegação correspondente à página aberta. */
export function marcarItemAtivo() {
  const pagina = window.location.pathname.split('/').pop() || 'mapa.html';
  document.querySelectorAll('.bottom-nav__item').forEach((item) => {
    const alvo = item.getAttribute('href');
    if (alvo === pagina) {
      item.classList.add('ativo');
      item.setAttribute('aria-current', 'page');
    }
  });
}

/** Botão "+" central: abre o modal com as 3 opções de cadastro. */
export function prepararBotaoCentral() {
  const fab = document.getElementById('botao-central');
  fab?.addEventListener('click', () => abrirModal('modal-cadastrar'));
}

/** Conta notificações não lidas e mostra o badge vermelho no sino. */
export async function atualizarBadgeNotificacoes() {
  const badge = document.getElementById('badge-notificacoes');
  if (!badge) return;

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error || !count) {
    badge.hidden = true;
    return;
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.hidden = false;
}
