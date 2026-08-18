/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela 3 (Comunidade)
   Liga o feed, os filtros, a publicação e as notificações. A lógica de
   verdade mora em community.js/notifications.js (reaproveitados também pela
   Tela 1, que também tem o modal de publicação) — aqui só orquestra.
   ============================================================================ */

import { exigirLogin, iniciarAuth } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, prepararTrocaDeModal, abrirModal } from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
import {
  carregarFeed, prepararFiltrosDeComunidade, ligarRealtimePosts,
  prepararFormularioPublicacao, prepararComentarios
} from './community.js';

async function iniciar() {
  aplicarIcones();
  const usuario = await exigirLogin();
  if (!usuario) return;

  iniciarAuth();
  prepararModais();
  prepararTrocaDeModal();
  marcarItemAtivo();
  prepararNotificacoes();

  document.getElementById('nome-usuaria').textContent = usuario.user_metadata?.full_name || usuario.email;

  // Nesta tela só existe uma coisa pra cadastrar (publicação), então o "+"
  // abre o formulário direto — sem o painel "o que você deseja cadastrar?"
  // que a Tela 1 usa (lá tem três opções).
  document.getElementById('botao-central')?.addEventListener('click', () => {
    abrirModal('modal-publicacao');
  });

  prepararFiltrosDeComunidade();
  prepararFormularioPublicacao({ aoPublicar: () => carregarFeed() });
  prepararComentarios();

  await Promise.all([carregarFeed(), atualizarBadgeNotificacoes()]);
  ligarRealtimePosts();
  ligarRealtimeBadgeNotificacoes();
}

document.addEventListener('DOMContentLoaded', iniciar);
