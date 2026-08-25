/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela 1 (Mapa)
   Liga todas as peças na ordem certa.
   ============================================================================ */

import { exigirLogin, iniciarAuth } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, prepararTrocaDeModal, abrirModal, fecharModal, prepararLightboxDeFotos } from './ui.js';
import {
  criarMapa, localizarUsuario, carregarDadosDaAreaVisivel,
  recentralizar, ligarRealtimeRelatos, posicaoUsuario, ligarFiltroDeFontesPublicas,
  aoAtualizarRelatos
} from './map.js';
import { ligarFiltroDeAlertasProximidade, acompanharLocalizacaoDoAlerta } from './push.js';
import { ligarRiscoPorHorario } from './risco-horario.js';
import { carregarListaRelatos, prepararFormularioRelato, seletorDeLocalDoRelato } from './reports.js';
import { prepararFormularioPonto, seletorDeLocalDoPonto } from './support-points.js';
import { prepararFormularioPublicacao } from './community.js';
import { prepararNotificacoes } from './notifications.js';
import { prepararBusca } from './search.js';
import { marcarItemAtivo, prepararBotaoCentral, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { registrarServiceWorker, ligarBotaoInstalarApp } from './pwa.js';

async function iniciar() {
  // 1. Ícones SVG em todo lugar que tem data-icone
  aplicarIcones();
  registrarServiceWorker('../sw.js');
  ligarBotaoInstalarApp();

  // 2. Sem login, ninguém entra
  const usuario = await exigirLogin();
  if (!usuario) return;

  // 3. Peças de interface
  iniciarAuth();
  prepararModais();
  prepararTrocaDeModal();
  prepararLightboxDeFotos();
  marcarItemAtivo();
  prepararBotaoCentral();
  prepararNotificacoes();

  // 4. Mapa
  criarMapa('mapa');
  document.getElementById('botao-recentralizar')
    ?.addEventListener('click', recentralizar);
  ligarFiltroDeFontesPublicas();
  ligarFiltroDeAlertasProximidade(posicaoUsuario);
  // A "área de interesse" do alerta acompanha o GPS de verdade: este
  // listener já dispara sempre que uma leitura nova recarrega os dados da
  // área visível (criarMapa -> moveend), então é o gancho certo pra manter
  // a assinatura atualizada sem inventar um watch novo só pra isso.
  aoAtualizarRelatos(() => acompanharLocalizacaoDoAlerta(posicaoUsuario));

  // 5 e 6. BUG DE PERFORMANCE QUE ISTO CORRIGE: antes, os relatos/pontos de
  // apoio/delegacias só começavam a carregar DEPOIS do GPS responder — e o
  // GPS pode levar até 15s (obterPosicao usa tempoMaximo: 15000). Isso fazia
  // o mapa parecer travado bem no primeiro acesso, com a tela vazia por até
  // 15 segundos, mesmo o mapa não precisando saber sua localização exata pra
  // mostrar os dados da área padrão (Rio de Janeiro). Agora os dados carregam
  // na hora, com a área padrão; o GPS roda em paralelo, e quando responde,
  // o próprio mapa recentra sozinho — o que já dispara moveend e recarrega
  // os dados pra área nova automaticamente (listener já ligado em criarMapa).
  localizarUsuario({ silencioso: true });

  await carregarDadosDaAreaVisivel();
  ligarRiscoPorHorario();
  await carregarListaRelatos();
  await atualizarBadgeNotificacoes();
  ligarRealtimeBadgeNotificacoes();

  // 7. Formulários e busca
  prepararBusca();
  prepararFormularioRelato();
  prepararFormularioPonto();
  prepararFormularioPublicacao();

  // 8. Atualização em tempo real quando alguém cria um relato
  ligarRealtimeRelatos();

  // 9. Escolhas do modal "O que você deseja cadastrar?"
  //    Cada formulário começa com o local VAZIO. Nada do que você pesquisou
  //    no mapa principal é herdado aqui — são coisas separadas.
  const seletoresPorModal = {
    'modal-relato': seletorDeLocalDoRelato,
    'modal-ponto': seletorDeLocalDoPonto
  };

  document.querySelectorAll('[data-abrir]').forEach((botao) => {
    botao.addEventListener('click', () => {
      fecharModal('modal-cadastrar');
      const destino = botao.dataset.abrir;

      if (destino === 'modal-publicacao') {
        // Diferente de relato/ponto: localização é opcional aqui, então não
        // pede GPS sozinho — só abre o formulário.
        setTimeout(() => abrirModal(destino), 120);
        return;
      }

      const seletor = seletoresPorModal[destino]?.();
      seletor?.limpar();

      setTimeout(() => {
        abrirModal(destino);
        // O mini-mapa nasce dentro de um modal escondido: precisa recalcular
        // o tamanho depois que ele aparece, senão fica cinza.
        seletor?.aoExibir(posicaoUsuario());
      }, 120);
    });
  });

  // 9.1 Ao fechar o formulário, o local escolhido é descartado
  Object.entries(seletoresPorModal).forEach(([idModal, pegarSeletor]) => {
    document.getElementById(idModal)
      ?.querySelectorAll('[data-fechar]')
      .forEach((btn) => btn.addEventListener('click', () => pegarSeletor()?.limpar()));
  });

  // 10. Nome da usuária no menu
  const saudacao = document.getElementById('nome-usuaria');
  if (saudacao) {
    saudacao.textContent = usuario.user_metadata?.full_name || usuario.email;
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
