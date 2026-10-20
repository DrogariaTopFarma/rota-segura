/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela Observatório
   Painel próprio (não é mais aba escondida dentro de Comunidade) — a lógica
   dos gráficos/tabela mora em js/observatorio-graficos.js, reaproveitada
   sem mudar nada. Aqui só o login/ícones/nav de sempre, igual às outras
   telas (ver js/alertas.js, js/app.js).
   ============================================================================ */

import { exigirLogin, iniciarAuth, perfilDeCabecalho } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, prepararTrocaDeModal } from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
import { registrarServiceWorker, ligarBotaoInstalarApp } from './pwa.js';
import { carregarObservatorio } from './observatorio-graficos.js';
import { corrigirBairroDosProprios } from './reports.js';

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

  await Promise.all([carregarObservatorio(), atualizarBadgeNotificacoes()]);
  ligarRealtimeBadgeNotificacoes();

  // Sem await de propósito: conserta em segundo plano os relatos DELA que
  // ficaram sem bairro (cadastrados antes dessa coluna existir), sem travar
  // a tela esperando — ver corrigirBairroDosProprios em js/reports.js. Só
  // ajuda a PRÓXIMA visita a mostrar mais dado (resolver leva tempo real de
  // geocodificação), não a desta mesma carga.
  corrigirBairroDosProprios().catch((erro) => console.error('Não foi possível corrigir bairro de relatos antigos:', erro));
}

document.addEventListener('DOMContentLoaded', iniciar);
