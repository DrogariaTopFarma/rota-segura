/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela 1 (Mapa)
   Liga todas as peças na ordem certa.
   ============================================================================ */

import { exigirLogin, iniciarAuth } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, abrirModal, fecharModal, toast } from './ui.js';
import {
  criarMapa, localizarUsuario, carregarDadosDaAreaVisivel,
  recentralizar, ligarRealtimeRelatos, posicaoUsuario
} from './map.js';
import { carregarListaRelatos, prepararFormularioRelato, seletorDeLocalDoRelato } from './reports.js';
import { prepararFormularioPonto, seletorDeLocalDoPonto } from './support-points.js';
import { prepararBusca } from './search.js';
import { marcarItemAtivo, prepararBotaoCentral, atualizarBadgeNotificacoes } from './nav.js';

async function iniciar() {
  // 1. Ícones SVG em todo lugar que tem data-icone
  aplicarIcones();

  // 2. Sem login, ninguém entra
  const usuario = await exigirLogin();
  if (!usuario) return;

  // 3. Peças de interface
  iniciarAuth();
  prepararModais();
  marcarItemAtivo();
  prepararBotaoCentral();

  // 4. Mapa
  criarMapa('mapa');
  document.getElementById('botao-recentralizar')
    ?.addEventListener('click', recentralizar);

  // 5. Localização (não bloqueia o resto se falhar)
  await localizarUsuario({ silencioso: true });

  // 6. Dados
  await carregarDadosDaAreaVisivel();
  await carregarListaRelatos();
  await atualizarBadgeNotificacoes();

  // 7. Formulários e busca
  prepararBusca();
  prepararFormularioRelato();
  prepararFormularioPonto();

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
        toast('As publicações da Comunidade chegam no Bloco 3.', 'info');
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
