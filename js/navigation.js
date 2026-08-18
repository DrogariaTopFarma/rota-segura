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
import { supabase } from './supabase.js';
import { obterLinkDeCompartilhamento } from './emergency.js';

// "Saiu da rota" — regra nova, com evidência de por que a antiga (50m fixos +
// 2 leituras seguidas) dava alarme falso: GPS a pé costuma variar 20-40m
// mesmo parado, e 2 leituras seguidas pode significar só 2-4 segundos com
// watchPosition. Agora: (1) a margem cresce com a IMPRECISÃO relatada pelo
// próprio GPS naquela leitura — não é um número fixo; (2) só confirma depois
// de ficar fora por um tempo MÍNIMO sustentado, não por contagem de leituras
// (que varia com a frequência do GPS do aparelho).
const LIMITE_BASE_FORA_DA_ROTA_M = 35;
const FATOR_MARGEM_PRECISAO = 1.5;
const LIMITE_MAXIMO_EFETIVO_M = 100;
const TEMPO_MINIMO_FORA_MS = 8000;
const LIMITE_CHEGADA_M = 25;

// Câmera durante a navegação (acompanhamento estilo Waze, sem copiar a
// interface): distância mínima antes de mexer a câmera ou recalcular o
// rumo, pra não reagir a ruído do GPS quando a pessoa está parada.
const DISTANCIA_MINIMA_PARA_SEGUIR_M = 5;
const DISTANCIA_MINIMA_PARA_RUMO_M = 4;

let mapa = null;
let rotaGeometria = null;
let rotaInfo = null;      // { distanciaM, duracaoS } da rota original
let destinoAtual = null;
let aoSairCallback = null;

let marcadorPosicaoAtual = null;
let pararAcompanhamento = null;
let pararSimulacao = null;
let desdeQuandoPareceForaDaRota = null; // timestamp (ms) da 1ª leitura seguida fora
let jaAvisouSaida = false;
let navegacaoAtiva = false;

let seguindoAutomaticamente = true; // pausa quando a pessoa arrasta o mapa
let posicaoAnterior = null;         // pra calcular deslocamento e rumo
let rumoAtual = null;               // graus (0-360), null até termos um rumo confiável
let detectorDeArrastoLigado = false; // liga o listener de dragstart só uma vez por página

// O mapa da Tela 2 é criado com {rotate:true} (routes.js) — gira o mapa
// inteiro pra manter a direção do trajeto sempre "pra cima" na tela (estilo
// GPS de navegação de verdade), em vez de só girar o ícone da seta sobre um
// mapa parado. Leaflet exige suporte a transform 3D pra isso (qualquer
// navegador de celular atual tem); nos raros casos sem suporte, cai pro
// comportamento antigo (mapa fixo, só a seta gira) em vez de travar.
const rotacaoDoMapaAtiva = typeof L !== 'undefined' && L.Browser?.any3d;

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

  navegacaoAtiva = true;
  desdeQuandoPareceForaDaRota = null;
  jaAvisouSaida = false;
  seguindoAutomaticamente = true;
  posicaoAnterior = null;
  rumoAtual = null;

  document.getElementById('painel-navegacao').hidden = false;
  document.getElementById('navegacao-destino').textContent = `Indo para ${destino.nome}`;

  document.getElementById('navegacao-recentralizar').onclick = () => {
    seguindoAutomaticamente = true;
    if (marcadorPosicaoAtual) {
      mapa.setView(marcadorPosicaoAtual.getLatLng(), APP_CONFIG.zoomSeletor, { animate: true });
      // Recentralizar também devolve a orientação "de frente" (rumo pra
      // cima), não só a posição — senão a pessoa via a câmera voltar pro
      // lugar certo mas ainda torta, do jeito que ela tinha deixado ao girar
      // o mapa manualmente.
      if (rotacaoDoMapaAtiva && rumoAtual !== null) mapa.setBearing(rumoAtual);
    }
  };
  document.getElementById('navegacao-encerrar').onclick = () => abrirModal('modal-encerrar-rota');
  document.getElementById('navegacao-compartilhar').onclick = compartilharRota;
  ligarBotoesDosModais();
  ligarDetectorDeArrasto();

  // Acompanhamento real (GPS de verdade) sempre — mesmo quando a partida foi
  // digitada à mão em vez de vir do GPS. Digitar o endereço de partida é só
  // um jeito de conferir/corrigir de onde você está partindo (por exemplo,
  // enquanto o GPS ainda não travou uma posição boa); a partir do momento
  // que a navegação começa, o acompanhamento é sempre real, então segue o
  // GPS de verdade a partir daqui, não fica preso ao ponto digitado.
  //
  // Já entra no zoom de acompanhamento (mais perto que a visão geral da
  // rota que a Tela 2 deixou no mapa) — depois disso, panTo só recentraliza,
  // sem forçar zoom de novo a cada leitura.
  mapa.setView([origem.lat, origem.lng], APP_CONFIG.zoomSeletor, { animate: true });
  desenharPosicaoAtual(origem.lat, origem.lng);
  atualizarProgresso(distanciaMetros(origem.lat, origem.lng, destino.lat, destino.lng));

  const simulandoTeste = new URLSearchParams(location.search).get('simular') === '1';
  if (simulandoTeste) {
    ligarSimulacao();
  } else {
    pararAcompanhamento = acompanharPosicao(
      (pos) => processarPosicao(pos.lat, pos.lng, pos.precisao),
      (erro) => toast(mensagemDoMotivo(erro.motivo), 'erro', 6000)
    );
  }
}

/* --------------------------------------------------- Processar posição --- */
function processarPosicao(lat, lng, precisaoM) {
  if (!navegacaoAtiva) return;
  desenharPosicaoAtual(lat, lng);

  const distDestino = distanciaMetros(lat, lng, destinoAtual.lat, destinoAtual.lng);
  atualizarProgresso(distDestino);

  if (distDestino <= LIMITE_CHEGADA_M) {
    finalizarPorChegada();
    return;
  }

  const distRota = distanciaMinimaDaRota(lat, lng);
  // A margem cresce com a imprecisão QUE O PRÓPRIO GPS relatou nesta leitura
  // (pos.coords.accuracy) — uma leitura de 80m de precisão não pode usar a
  // mesma régua rígida que uma de 5m. O teto evita que um GPS péssimo
  // desligue a checagem por completo.
  const limiteEfetivo = Math.min(
    LIMITE_MAXIMO_EFETIVO_M,
    LIMITE_BASE_FORA_DA_ROTA_M + (precisaoM || 0) * FATOR_MARGEM_PRECISAO
  );

  if (distRota <= limiteEfetivo) {
    desdeQuandoPareceForaDaRota = null;
    return;
  }

  // Parece fora da rota — só confirma se isso persistir por um tempo mínimo.
  // Uma leitura isolada de ruído nunca chega a somar esse tempo, porque a
  // primeira leitura BOA que chegar no meio do caminho já reseta o relógio
  // acima. É isso que impede o aviso de aparecer/sumir repetidamente.
  if (desdeQuandoPareceForaDaRota === null) {
    desdeQuandoPareceForaDaRota = Date.now();
    return;
  }
  const tempoForaMs = Date.now() - desdeQuandoPareceForaDaRota;
  if (tempoForaMs >= TEMPO_MINIMO_FORA_MS && !jaAvisouSaida) {
    jaAvisouSaida = true;
    abrirModal('modal-saiu-rota');
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
/** Direção (graus, 0-360, 0 = norte) do ponto 1 pro ponto 2. */
function calcularRumo(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const dLng = rad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Pino com seta — igual visualmente ao círculo azul de antes, mas
    apontando pra direção do deslocamento. Girar só a seta (via CSS, com
    transição suave) em vez de recriar o marcador a cada leitura.

    Quando o mapa em si já gira pro rumo (rotacaoDoMapaAtiva), a seta fica
    sempre reta pra cima — "pra cima" já É a direção do trajeto, então girar
    a seta também giraria ela duas vezes. Só gira a seta sozinha no fallback
    sem suporte a rotação de mapa (mapa fica parado, seta aponta o rumo). */
function iconeDirecional(rumoGraus) {
  const angulo = rotacaoDoMapaAtiva ? 0 : Math.round(rumoGraus);
  return L.divIcon({
    html: `<div class="navegacao-seta" style="transform: rotate(${angulo}deg)">
        <svg width="30" height="30" viewBox="0 0 30 30">
          <circle cx="15" cy="15" r="12" fill="#2F6BFF" stroke="#FFFFFF" stroke-width="3"/>
          <path d="M15 7 L20.5 19 L15 15.8 L9.5 19 Z" fill="#FFFFFF"/>
        </svg>
      </div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function desenharPosicaoAtual(lat, lng) {
  let deslocamentoM = null;
  if (posicaoAnterior) {
    deslocamentoM = distanciaMetros(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);
    // Só recalcula o rumo com deslocamento significativo — entre dois pontos
    // quase iguais, a direção calculada é só ruído do GPS, não uma guinada
    // real. Sem isto, a seta ficaria "tremendo" quando a pessoa está parada.
    if (deslocamentoM >= DISTANCIA_MINIMA_PARA_RUMO_M) {
      rumoAtual = calcularRumo(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);
    }
  }
  posicaoAnterior = { lat, lng };

  if (!marcadorPosicaoAtual) {
    marcadorPosicaoAtual = L.marker([lat, lng], {
      icon: iconeDirecional(rumoAtual || 0),
      zIndexOffset: 1000,
      interactive: false
    }).addTo(mapa);
  } else {
    marcadorPosicaoAtual.setLatLng([lat, lng]);
    if (rumoAtual !== null && !rotacaoDoMapaAtiva) {
      const seta = marcadorPosicaoAtual.getElement()?.querySelector('.navegacao-seta');
      if (seta) seta.style.transform = `rotate(${Math.round(rumoAtual)}deg)`;
    }
  }

  // Câmera acompanha a posição (só quando a pessoa não arrastou o mapa por
  // conta própria) — e só quando o deslocamento vale a pena, pra não ficar
  // reajustando a câmera por ruído do GPS enquanto a pessoa está parada.
  const primeiraLeitura = deslocamentoM === null;
  const deslocouOSuficiente = primeiraLeitura || deslocamentoM >= DISTANCIA_MINIMA_PARA_SEGUIR_M;
  if (seguindoAutomaticamente && deslocouOSuficiente) {
    mapa.panTo([lat, lng], { animate: true, duration: 0.5 });
  }

  // Gira o mapa pra manter o rumo sempre "pra cima" — só quando a pessoa não
  // tirou o controle da câmera arrastando o mapa (mesma regra do panTo acima).
  if (rotacaoDoMapaAtiva && seguindoAutomaticamente && rumoAtual !== null) {
    mapa.setBearing(rumoAtual);
  }
}

/** Pausa o acompanhamento automático quando a pessoa arrasta o mapa —
    ligado uma única vez (não a cada iniciarNavegacao) pra nunca duplicar
    o listener em navegações repetidas na mesma página. */
function ligarDetectorDeArrasto() {
  if (detectorDeArrastoLigado) return;
  detectorDeArrastoLigado = true;
  mapa.on('dragstart', () => {
    if (!navegacaoAtiva) return;
    seguindoAutomaticamente = false;
  });
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
  // Volta o mapa pra norte-pra-cima: fora da navegação ativa (Tela 2 em modo
  // planejamento) o mapa não deveria continuar torto do jeito que a última
  // navegação deixou.
  if (rotacaoDoMapaAtiva && mapa) mapa.setBearing(0);
  posicaoAnterior = null;
  rumoAtual = null;
  aoSairCallback?.();
}

function ligarBotoesDosModais() {
  // Continuar na rota atual: só fecha o aviso e volta a monitorar.
  document.getElementById('btn-continuar-rota').onclick = () => {
    fecharModal('modal-saiu-rota');
    jaAvisouSaida = false;
    desdeQuandoPareceForaDaRota = null;
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

/** Avisa um contato de confiança pra onde você está indo — diferente do
    SOS: aqui nada deu errado, é só precaução. Reaproveita o mesmo contato
    de emergência e o mesmo modal de aviso "sem contato" que o SOS já usa,
    já que a causa (nenhum contato cadastrado) é a mesma. */
async function compartilharRota() {
  const botao = document.getElementById('navegacao-compartilhar');
  // Mesmo motivo do SOS (routes.js/acionarSos): abrir a aba só depois do
  // Supabase/GPS resolverem faz o navegador bloquear como pop-up. Abre em
  // branco já no clique, troca a URL quando o link estiver pronto. Sem
  // "noopener" aqui — devolveria null e perderíamos a referência; w.opener
  // é zerado manualmente em vez disso, com a mesma proteção.
  const janela = window.open('', '_blank');
  if (janela) janela.opener = null;
  try {
    botao.disabled = true;
    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) { janela?.close(); return; }

    const { data: contatos, error } = await supabase
      .from('emergency_contacts')
      .select('phone')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })
      .limit(1);
    if (error) throw error;

    if (!contatos || !contatos.length) {
      janela?.close();
      abrirModal('modal-sos-sem-contato');
      return;
    }

    const { url } = await obterLinkDeCompartilhamento(contatos[0].phone, destinoAtual?.nome || 'meu destino');
    if (janela) janela.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (erro) {
    janela?.close();
    toast(erro.message || 'Não foi possível compartilhar a rota agora.', 'erro', 6000);
  } finally {
    botao.disabled = false;
  }
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
