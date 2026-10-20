/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela Central de ajuda
   Conteúdo 100% estático (números de emergência, o que fazer em situações de
   risco, direitos básicos, segurança digital) — direto no HTML, sem consulta
   ao banco. Aqui só o login/ícones/nav de sempre, igual às outras telas (ver
   js/observatorio.js).
   ============================================================================ */

import { exigirLogin, iniciarAuth, perfilDeCabecalho } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, prepararTrocaDeModal } from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
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

  await atualizarBadgeNotificacoes();
  ligarRealtimeBadgeNotificacoes();
}

document.addEventListener('DOMContentLoaded', iniciar);
