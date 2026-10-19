/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela 3 (Comunidade)
   Liga o feed, os filtros, a publicação e as notificações. A lógica de
   verdade mora em community.js/notifications.js (reaproveitados também pela
   Tela 1, que também tem o modal de publicação) — aqui só orquestra.
   ============================================================================ */

import { exigirLogin, iniciarAuth, perfilDeCabecalho } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, prepararTrocaDeModal, abrirModal } from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
import {
  carregarFeed, prepararFiltrosDeComunidade, ligarRealtimePosts,
  prepararFormularioPublicacao, prepararComentarios
} from './community.js';
import { prepararChatVanessa } from './vanessa.js';
import { registrarServiceWorker, ligarBotaoInstalarApp } from './pwa.js';

async function iniciar() {
  aplicarIcones();
  registrarServiceWorker('../sw.js');
  ligarBotaoInstalarApp();
  const usuario = await exigirLogin();
  if (!usuario) return;

  iniciarAuth();
  prepararModais();
  prepararTrocaDeModal();
  marcarItemAtivo();
  prepararNotificacoes();

  perfilDeCabecalho(usuario).then(({ nome }) => {
    document.getElementById('nome-usuaria').textContent = nome;
  });

  // Nesta tela só existe uma coisa pra cadastrar (publicação), então o "+"
  // abre o formulário direto — sem o painel "o que você deseja cadastrar?"
  // que a Tela 1 usa (lá tem três opções).
  document.getElementById('botao-central')?.addEventListener('click', () => {
    abrirModal('modal-publicacao');
  });

  prepararFiltrosDeComunidade();
  prepararFormularioPublicacao({ aoPublicar: () => carregarFeed() });
  prepararComentarios();
  prepararChatVanessa();

  // Veio do atalho "Falar com Vanessa" da tela Início (?abrirVanessa=1, ver
  // js/inicio.js) — abre o chat direto, sem precisar achar o botão flutuante.
  if (new URLSearchParams(window.location.search).get('abrirVanessa') === '1') {
    document.getElementById('abrir-vanessa')?.click();
  }

  await Promise.all([carregarFeed(), atualizarBadgeNotificacoes()]);
  ligarRealtimePosts();
  ligarRealtimeBadgeNotificacoes();
}

document.addEventListener('DOMContentLoaded', iniciar);
