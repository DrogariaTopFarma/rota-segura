/* ============================================================================
   ROTA SEGURA — Navegação ativa (Bloco 2)

   Regras que vêm direto do pedido:
   - GPS real via watchPosition (ou, com ?simular=1 na URL, cliques no mapa —
     um jeito de testar sem sair andando por aí, claramente marcado como teste
     e nunca ligado sozinho).
   - Nenhuma chamada nova ao OpenRouteService durante a navegação: a rota já
     foi calculada uma vez; daqui pra frente é só matemática local.
   - Sair da rota NUNCA recalcula sozinho — mostra aviso e você decide.
   ============================================================================ */

import { acompanharPosicao, mensagemDoMotivo } from './geolocation.js';
import { abrirModal, fecharModal, toast, distanciaMetros } from './ui.js';
import { APP_CONFIG } from './config.js';

const LIMITE_FORA_DA_ROTA_M = 50;
const LEITURAS_PARA_CONFIRMAR_SAIDA = 2;
const LIMITE_CHEGADA_M = 25;

let mapa = null;
let rotaGeometria = null;
let rotaInfo = null;      // { distanciaM, duracaoS } da rota original
let destinoAtual = null;
let aoSairCallback = null;

let marcadorPosicaoAtual = null;
let pararAcompanhamento = null;
let pararSimulacao = null;
let leiturasForaDaRota = 0;
let jaAvisouSaida = false;
let navegacaoAtiva = false;
let modoPrevia = false; // origem foi digitada à mão: sem GPS real, só mostra a rota

/**
 * @param {object} args
 * @param {L.Map} args.mapa - mapa já criado pela Tela 2 (não cria um novo)
 * @param {{lat:number,lng:number,nome:string,fonte:'gps'|'manual'}} args.origem
 * @param {{lat:number,lng:number,nome:string}} args.destino
 * @param {{distanciaM:number,duracaoS:number,geometria:number[][]}} args.rota
 * @param {() => void} args.aoSair - chamado quando a navegação termina (chegada, encerrar ou escolher outra rota)
 */
export function iniciarNavegacao({ mapa: mapaRecebido, origem, destino, rota, aoSair }) {
  mapa = mapaRecebido;
  rotaGeometria = rota.geometria;
  rotaInfo = { distanciaM: rota.distanciaM, duracaoS: rota.duracaoS };
  destinoAtual = destino;
  aoSairCallback = aoSair;
  modoPrevia = origem.fonte === 'manual';

  navegacaoAtiva = true;
  leiturasForaDaRota = 0;
  jaAvisouSaida = false;

  document.getElementById('painel-navegacao').hidden = false;
  document.getElementById('navegacao-destino').textContent = `Indo para ${destino.nome}`;
  document.getElementById('navegacao-aviso-previa').hidden = !modoPrevia;

  document.getElementById('navegacao-recentralizar').onclick = () => {
    if (modoPrevia) {
      mapa.fitBounds(L.latLngBounds(rotaGeometria), { padding: [40, 40] });
    } else if (marcadorPosicaoAtual) {
      mapa.setView(marcadorPosicaoAtual.getLatLng(), APP_CONFIG.zoomSeletor);
    }
  };
  document.getElementById('navegacao-encerrar').onclick = () => abrirModal('modal-encerrar-rota');
  ligarBotoesDosModais();

  if (modoPrevia) {
    // Origem digitada à mão: não existe uma posição real da usuária para
    // seguir. Mostra a rota calculada como prévia — sem GPS, sem detectar
    // desvio nem chegada (regra pedida: nunca tratar isso como navegação
    // em tempo real quando a partida não veio do GPS). O pino de partida já
    // foi desenhado pela Tela 2 (routes.js); não duplica outro aqui.
    atualizarProgresso(rotaInfo.distanciaM, { rotulo: 'no total — prévia, sem GPS' });
    return;
  }

  desenharPosicaoAtual(origem.lat, origem.lng);
  atualizarProgresso(distanciaMetros(origem.lat, origem.lng, destino.lat, destino.lng));

  const simulandoTeste = new URLSearchParams(location.search).get('simular') === '1';
  if (simulandoTeste) {
    ligarSimulacao();
  } else {
    pararAcompanhamento = acompanharPosicao(
      (pos) => processarPosicao(pos.lat, pos.lng),
      (erro) => toast(mensagemDoMotivo(erro.motivo), 'erro', 6000)
    );
  }
}

/* --------------------------------------------------- Processar posição --- */
function processarPosicao(lat, lng) {
  if (!navegacaoAtiva) return;
  desenharPosicaoAtual(lat, lng);

  const distDestino = distanciaMetros(lat, lng, destinoAtual.lat, destinoAtual.lng);
  atualizarProgresso(distDestino);

  if (distDestino <= LIMITE_CHEGADA_M) {
    finalizarPorChegada();
    return;
  }

  const distRota = distanciaMinimaDaRota(lat, lng);
  if (distRota > LIMITE_FORA_DA_ROTA_M) {
    leiturasForaDaRota++;
    // Exige 2 leituras seguidas longe da rota antes de avisar — evita alarme
    // falso por um único salto de precisão do GPS.
    if (leiturasForaDaRota >= LEITURAS_PARA_CONFIRMAR_SAIDA && !jaAvisouSaida) {
      jaAvisouSaida = true;
      abrirModal('modal-saiu-rota');
    }
  } else {
    leiturasForaDaRota = 0;
  }
}

function distanciaMinimaDaRota(lat, lng) {
  let menor = Infinity;
  for (const [rLat, rLng] of rotaGeometria) {
    const d = distanciaMetros(lat, lng, rLat, rLng);
    if (d < menor) menor = d;
  }
  return menor;
}

/* ------------------------------------------------------------- Desenho --- */
function desenharPosicaoAtual(lat, lng) {
  if (!marcadorPosicaoAtual) {
    marcadorPosicaoAtual = L.circleMarker([lat, lng], {
      radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#2F6BFF', fillOpacity: 1
    }).addTo(mapa);
  } else {
    marcadorPosicaoAtual.setLatLng([lat, lng]);
  }
}

function formatarDuracao(segundos) {
  const totalMin = Math.round(segundos / 60);
  if (totalMin < 1) return 'menos de 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${horas} h` : `${horas} h ${min} min`;
}

function formatarDistancia(metros) {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`;
}

/** Tempo é estimado a partir do ritmo médio da rota original — não liga de
    novo para o OpenRouteService durante a navegação (regra do Bloco 2). */
function atualizarProgresso(distanciaM, { rotulo = 'restantes (estimado)' } = {}) {
  const ritmoSPorM = rotaInfo.duracaoS / Math.max(rotaInfo.distanciaM, 1);
  const tempoS = distanciaM * ritmoSPorM;
  document.getElementById('navegacao-distancia').textContent = formatarDistancia(distanciaM);
  document.getElementById('navegacao-tempo').textContent = `${formatarDuracao(tempoS)} ${rotulo}`;
}

/* ---------------------------------------------------- Fim da navegação --- */
function finalizarPorChegada() {
  // Encerra tudo já ao detectar a chegada (GPS, marcador, volta à Tela 2) — o
  // aviso abaixo é só uma confirmação por cima, não uma condição para isso
  // acontecer. Assim, fechar o aviso sem tocar em "Concluir" (Esc, clique
  // fora) não deixa a navegação numa tela morta.
  abrirModal('modal-chegada');
  encerrar();
}

function encerrar() {
  navegacaoAtiva = false;
  pararAcompanhamento?.();
  pararAcompanhamento = null;
  pararSimulacao?.();
  pararSimulacao = null;
  if (marcadorPosicaoAtual && mapa) { mapa.removeLayer(marcadorPosicaoAtual); marcadorPosicaoAtual = null; }
  aoSairCallback?.();
}

function ligarBotoesDosModais() {
  // Continuar na rota atual: só fecha o aviso e volta a monitorar.
  document.getElementById('btn-continuar-rota').onclick = () => {
    fecharModal('modal-saiu-rota');
    jaAvisouSaida = false;
    leiturasForaDaRota = 0;
  };
  // Escolher outra rota: encerra esta navegação e volta para a Tela 2, onde a
  // usuária escolhe/confirma um novo destino e calcula manualmente. O app
  // nunca decide sozinho qual rota usar.
  document.getElementById('btn-escolher-outra-rota').onclick = () => {
    fecharModal('modal-saiu-rota');
    encerrar();
  };
  // O encerramento em si já aconteceu assim que a chegada foi detectada
  // (finalizarPorChegada) — aqui só fecha o aviso.
  document.getElementById('btn-concluir-chegada').onclick = () => {
    fecharModal('modal-chegada');
  };
  document.getElementById('btn-confirmar-encerrar').onclick = () => {
    fecharModal('modal-encerrar-rota');
    encerrar();
  };
}

/* --------------------------------------- Modo de teste (GPS simulado) --- */
/** Só ativa com ?simular=1 na URL. Clicar no mapa "anda" até aquele ponto. */
function ligarSimulacao() {
  const aoClicar = (e) => processarPosicao(e.latlng.lat, e.latlng.lng);
  mapa.on('click', aoClicar);
  pararSimulacao = () => mapa.off('click', aoClicar);
}

/* --------------------------------------------------------------- Limpeza --- */
window.addEventListener('beforeunload', () => { pararAcompanhamento?.(); });
