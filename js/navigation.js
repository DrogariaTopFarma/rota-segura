/* ============================================================================
   ROTA SEGURA — Navegação ativa (Bloco 2)

   ARQUITETURA (revisada com foco em UX + confiabilidade de navegação real):

   1. LOCALIZAÇÃO FÍSICA vs. POSIÇÃO NA ROTA
      O GPS te dá uma coordenada (com erro). A rota calculada é uma
      geometria (uma sequência de pontos). "Onde estou na rota" não é a
      mesma pergunta que "onde o GPS diz que eu estou" — por isso todo
      cálculo de progresso/desvio projeta a posição real no SEGMENTO de reta
      mais próximo da rota (não só no vértice mais próximo, que pode estar
      longe se o trecho for comprido), em vez de comparar coordenadas cruas.
      Isso é o "map-matching" possível sem trocar de tecnologia: usa só a
      geometria que o OpenRouteService já devolveu.

   2. "SAIR DA ROTA" só é avaliado depois que a pessoa JÁ chegou perto da
      rota pelo menos uma vez nesta navegação (`conectouNaRota`). Isso evita
      alarme falso logo ao iniciar: se o GPS te colocou 80m dentro de um
      condomínio, esse afastamento inicial não é um desvio, é só o trecho
      entre "onde você está" e "onde a via mapeada começa". Ninguém precisa
      andar até a rua pra poder apertar "Iniciar".

   3. CÂMERA: não é "setView a cada leitura do GPS". O rumo só é atualizado
      com evidência real de movimento (deslocamento mínimo ESCALADO pela
      imprecisão do GPS + velocidade estimada mínima) e suavizado por média
      circular entre leituras — parada em casa não gira o mapa sozinho. A
      rotação do mapa (e o fallback de girar só o ícone, em navegadores sem
      suporte a rotação) sempre anima pelo MENOR caminho angular (um
      utilitário próprio, não uma transição CSS comum — CSS/o plugin de
      rotação não sabem que 359° e 2° são quase o mesmo ângulo, e podiam
      girar quase uma volta inteira só pra "ajustar" 3°).

   Regras que já vêm de pedidos anteriores, mantidas:
   - GPS real via watchPosition (ou, com ?simular=1 na URL, cliques no mapa).
   - Nenhuma chamada nova ao OpenRouteService durante a navegação.
   - Sair da rota NUNCA recalcula sozinho — mostra aviso e você decide.
   ============================================================================ */

import { acompanharPosicao, mensagemDoMotivo } from './geolocation.js';
import { abrirModal, fecharModal, toast, distanciaMetros } from './ui.js';
import { APP_CONFIG } from './config.js';
import { supabase } from './supabase.js';
import { obterLinkDeCompartilhamento } from './emergency.js';

// "Saiu da rota": a margem cresce com a IMPRECISÃO relatada pelo próprio GPS
// naquela leitura — não é um número fixo. Só confirma depois de ficar fora
// por um tempo MÍNIMO sustentado (não por contagem de leituras, que varia
// com a frequência do GPS do aparelho).
const LIMITE_BASE_FORA_DA_ROTA_M = 35;
const FATOR_MARGEM_PRECISAO = 1.5;
const LIMITE_MAXIMO_EFETIVO_M = 100;
const TEMPO_MINIMO_FORA_MS = 8000;
const LIMITE_CHEGADA_M = 25;

// Câmera durante a navegação: distância mínima (escalada pela imprecisão do
// GPS) e velocidade mínima estimada antes de aceitar um novo rumo — sem
// isso, ruído do GPS parado vira "giro sozinho".
const DISTANCIA_MINIMA_PARA_SEGUIR_M = 5;
const DISTANCIA_MINIMA_PARA_RUMO_M = 4;
const FATOR_MARGEM_PRECISAO_RUMO = 1.2;
const VELOCIDADE_MINIMA_PARA_RUMO_MS = 0.5; // ~1,8 km/h — abaixo disso, "parada"
const PESO_RUMO_NOVO = 0.6; // suavização: quanto o rumo mais recente pesa vs. o anterior

// Câmera de navegação: a pessoa fica um pouco abaixo do centro da tela, pra
// sobrar mais mapa mostrando o que vem PELA FRENTE — só faz sentido com o
// mapa girando (senão "pra cima" não é necessariamente "pra frente").
const FRACAO_OFFSET_CAMERA_Y = 0.22;

const DURACAO_ANIMACAO_GIRO_MS = 450;

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
let conectouNaRota = false; // já chegou perto o bastante da rota, pelo menos 1x nesta navegação

let seguindoAutomaticamente = true; // pausa quando a pessoa arrasta o mapa
let posicaoAnterior = null;         // { lat, lng, quando } — pra calcular deslocamento, velocidade e rumo
let rumoAtual = null;               // graus (0-360), null até termos um rumo confiável
let detectorDeArrastoLigado = false; // liga o listener de dragstart só uma vez por página

// O mapa da Tela 2 é criado com {rotate:true} (routes.js) — gira o mapa
// inteiro pra manter a direção do trajeto sempre "pra cima" na tela (estilo
// GPS de navegação de verdade), em vez de só girar o ícone da seta sobre um
// mapa parado. Leaflet exige suporte a transform 3D pra isso (qualquer
// navegador de celular atual tem); nos raros casos sem suporte, cai pro
// comportamento antigo (mapa fixo, só a seta gira) em vez de travar.
const rotacaoDoMapaAtiva = typeof L !== 'undefined' && L.Browser?.any3d;

/* ========================================================================== */
/* Utilitário: animação angular pelo MENOR caminho (evita o "giro de 358°")   */
/* ========================================================================== */

/**
 * Cria um animador de ângulo que guarda um valor CONTÍNUO (não limitado a
 * 0-360°) e anima suavemente até um novo alvo sempre pelo caminho mais
 * curto, chamando `aoAtualizar(anguloContinuo)` a cada quadro.
 *
 * Por que isso existe: tanto o plugin de rotação do mapa (leaflet-rotate)
 * quanto uma transição CSS comum em cima de uma propriedade `transform`
 * fazem a interpolação olhando só pros dois valores finais (ex.: 359° e
 * 2°) — sem saber que o caminho real mais curto entre eles é de só 3°. O
 * resultado visual é o mapa girando quase uma volta inteira pra "corrigir"
 * uma mudança de rumo pequena. Fazendo a interpolação nós mesmos, quadro a
 * quadro, com aritmética modular correta, isso nunca acontece.
 */
function criarAnimadorAngular(aoAtualizar, duracaoMs = DURACAO_ANIMACAO_GIRO_MS) {
  let anguloContinuo = 0;
  let animId = null;

  function irPara(anguloAlvoGraus) {
    const atualWrapped = ((anguloContinuo % 360) + 360) % 360;
    const delta = ((anguloAlvoGraus - atualWrapped + 540) % 360) - 180; // caminho mais curto, em (-180,180]
    const destino = anguloContinuo + delta;
    const inicio = anguloContinuo;
    const comeco = performance.now();
    if (animId) cancelAnimationFrame(animId);

    function passo(agora) {
      const t = Math.min(1, (agora - comeco) / duracaoMs);
      const suavizado = 1 - Math.pow(1 - t, 3); // ease-out cúbico
      anguloContinuo = inicio + (destino - inicio) * suavizado;
      aoAtualizar(anguloContinuo);
      animId = t < 1 ? requestAnimationFrame(passo) : null;
    }
    animId = requestAnimationFrame(passo);
  }

  function definirImediatamente(anguloGraus) {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    anguloContinuo = anguloGraus;
    aoAtualizar(anguloContinuo);
  }

  return { irPara, definirImediatamente };
}

const animadorBearing = criarAnimadorAngular((graus) => { mapa?.setBearing(graus); });
const animadorSeta = criarAnimadorAngular((graus) => {
  const seta = marcadorPosicaoAtual?.getElement()?.querySelector('.navegacao-seta');
  if (seta) seta.style.transform = `rotate(${graus}deg)`;
});

/** Média circular ponderada entre dois ângulos (graus) — a média aritmética
    direta de ângulos está errada perto do "norte" (a média de 359° e 2° não
    é 180°, é ~0,5°). Converte pra vetor unitário, mistura, volta pra ângulo.
    `peso` é o quanto o ângulo NOVO pesa (0 a 1) — suaviza ruído do GPS sem
    travar a resposta a uma curva real. */
function suavizarAnguloCircular(anguloAtual, anguloNovo, peso) {
  const rad = (g) => (g * Math.PI) / 180;
  const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
  const x = Math.cos(rad(anguloAtual)) * (1 - peso) + Math.cos(rad(anguloNovo)) * peso;
  const y = Math.sin(rad(anguloAtual)) * (1 - peso) + Math.sin(rad(anguloNovo)) * peso;
  return deg(Math.atan2(y, x));
}

/* ========================================================================== */
/* Utilitário: projeção da posição na geometria da rota (map-matching leve)  */
/* ========================================================================== */

/** Projeta um ponto no segmento de reta A→B (aproximação plana local, válida
    em escala de bairro/cidade) e devolve a distância até essa projeção — não
    até os vértices, até a RETA entre eles. Sem isso, alguém no meio de um
    trecho reto comprido podia parecer "longe da rota" só porque os dois
    vértices mais próximos estavam distantes. */
function projetarPontoNoSegmento(lat, lng, aLat, aLng, bLat, bLng) {
  const mPorGrauLat = 111320;
  const mPorGrauLng = 111320 * Math.cos((aLat * Math.PI) / 180);
  const bx = (bLng - aLng) * mPorGrauLng, by = (bLat - aLat) * mPorGrauLat;
  const px = (lng - aLng) * mPorGrauLng, py = (lat - aLat) * mPorGrauLat;
  const comprimento2 = bx * bx + by * by;
  let t = comprimento2 > 1e-9 ? (px * bx + py * by) / comprimento2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dist = Math.hypot(px - bx * t, py - by * t);
  return { dist, t };
}

/** Acha, em toda a geometria da rota, o ponto mais próximo da posição atual
    — testando cada segmento, não só os vértices. Devolve a distância até a
    rota, o índice do segmento e o quanto dele já foi percorrido (t: 0 a 1). */
function encontrarPontoMaisProximoNaRota(lat, lng) {
  let melhor = { dist: Infinity, indice: 0, t: 0 };
  for (let i = 0; i < rotaGeometria.length - 1; i++) {
    const [aLat, aLng] = rotaGeometria[i];
    const [bLat, bLng] = rotaGeometria[i + 1];
    const { dist, t } = projetarPontoNoSegmento(lat, lng, aLat, aLng, bLat, bLng);
    if (dist < melhor.dist) melhor = { dist, indice: i, t };
  }
  return melhor;
}

/** Distância restante SEGUINDO a geometria da rota a partir do ponto mais
    próximo já encontrado — não em linha reta até o destino. É isso que faz
    o "faltam X m" continuar fazendo sentido numa rota com curvas (linha reta
    subestima muito quando a rota dá a volta num quarteirão, por exemplo). */
function distanciaRestanteNaRota(indice, t) {
  const [aLat, aLng] = rotaGeometria[indice];
  const [bLat, bLng] = rotaGeometria[indice + 1];
  let restante = distanciaMetros(
    aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t,
    bLat, bLng
  );
  for (let i = indice + 1; i < rotaGeometria.length - 1; i++) {
    const [x1, y1] = rotaGeometria[i];
    const [x2, y2] = rotaGeometria[i + 1];
    restante += distanciaMetros(x1, y1, x2, y2);
  }
  return restante;
}

/* ========================================================================== */

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
  conectouNaRota = false;
  seguindoAutomaticamente = true;
  posicaoAnterior = null;
  rumoAtual = null;

  document.getElementById('painel-navegacao').hidden = false;
  document.getElementById('navegacao-destino').textContent = `Indo para ${destino.nome}`;

  document.getElementById('navegacao-recentralizar').onclick = () => {
    seguindoAutomaticamente = true;
    if (marcadorPosicaoAtual) {
      mapa.setView(pontoComOffsetDeCamera(marcadorPosicaoAtual.getLatLng()), APP_CONFIG.zoomSeletor, { animate: true });
      // Recentralizar também devolve a orientação "de frente" (rumo pra
      // cima), não só a posição — senão a pessoa via a câmera voltar pro
      // lugar certo mas ainda torta, do jeito que ela tinha deixado ao girar
      // o mapa manualmente. Sempre pelo caminho mais curto (animadorBearing).
      if (rotacaoDoMapaAtiva && rumoAtual !== null) animadorBearing.irPara(rumoAtual);
    }
  };
  document.getElementById('navegacao-encerrar').onclick = () => abrirModal('modal-encerrar-rota');
  document.getElementById('navegacao-compartilhar').onclick = compartilharRota;
  ligarBotoesDosModais();
  ligarDetectorDeArrasto();

  // Acompanhamento real (GPS de verdade) sempre — mesmo quando a partida foi
  // digitada à mão em vez de vir do GPS. Digitar o endereço de partida é só
  // um jeito de conferir/corrigir de onde você está partindo; a partir do
  // momento que a navegação começa, o acompanhamento segue o GPS de verdade.
  //
  // Já entra no zoom de acompanhamento (mais perto que a visão geral da
  // rota que a Tela 2 deixou no mapa) — depois disso, panTo só recentraliza,
  // sem forçar zoom de novo a cada leitura.
  mapa.setView([origem.lat, origem.lng], APP_CONFIG.zoomSeletor, { animate: true });
  desenharPosicaoAtual(origem.lat, origem.lng, null, Date.now());
  atualizarProgresso(distanciaMetros(origem.lat, origem.lng, destino.lat, destino.lng));

  const simulandoTeste = new URLSearchParams(location.search).get('simular') === '1';
  if (simulandoTeste) {
    ligarSimulacao();
  } else {
    pararAcompanhamento = acompanharPosicao(
      (pos) => processarPosicao(pos.lat, pos.lng, pos.precisao, pos.quando),
      (erro) => toast(mensagemDoMotivo(erro.motivo), 'erro', 6000)
    );
  }
}

/* --------------------------------------------------- Processar posição --- */
function processarPosicao(lat, lng, precisaoM, quandoMs) {
  if (!navegacaoAtiva) return;
  desenharPosicaoAtual(lat, lng, precisaoM, quandoMs ?? Date.now());

  // Chegada: distância direta até o destino mesmo (no fim da rota, distância
  // em linha reta e distância pela rota convergem pro mesmo valor de
  // qualquer forma — não precisa da projeção pra isso, e assim a detecção de
  // chegada fica simples e robusta).
  const distDestino = distanciaMetros(lat, lng, destinoAtual.lat, destinoAtual.lng);
  if (distDestino <= LIMITE_CHEGADA_M) {
    finalizarPorChegada();
    return;
  }

  const { dist: distRota, indice, t } = encontrarPontoMaisProximoNaRota(lat, lng);

  // "Faltam X m": segue a GEOMETRIA da rota a partir do ponto mais próximo
  // dela, não a linha reta até o destino — a linha reta erra bastante numa
  // rota com curvas ou voltas de quarteirão. Soma também o quanto falta pra
  // "entrar" na rota de fato (distRota), pra continuar fazendo sentido antes
  // de conectar (ex.: ainda saindo de dentro de um condomínio).
  atualizarProgresso(distRota + distanciaRestanteNaRota(indice, t));

  // A margem cresce com a imprecisão QUE O PRÓPRIO GPS relatou nesta leitura
  // (pos.coords.accuracy) — uma leitura de 80m de precisão não pode usar a
  // mesma régua rígida que uma de 5m. O teto evita que um GPS péssimo
  // desligue a checagem por completo.
  const limiteEfetivo = Math.min(
    LIMITE_MAXIMO_EFETIVO_M,
    LIMITE_BASE_FORA_DA_ROTA_M + (precisaoM || 0) * FATOR_MARGEM_PRECISAO
  );

  if (distRota <= limiteEfetivo) {
    conectouNaRota = true;
    desdeQuandoPareceForaDaRota = null;
    return;
  }

  // Antes de ter conectado à rota pelo menos uma vez, um afastamento não é
  // um desvio — é só a distância entre "onde o GPS te encontrou" (dentro de
  // casa, de um condomínio, de um estacionamento) e "onde a via mapeada
  // começa". Ninguém devia precisar sair na rua pra poder iniciar. Só depois
  // de já ter estado na rota é que "ficar longe dela" passa a significar
  // "saiu do caminho".
  if (!conectouNaRota) return;

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

/** Pino com seta — igual visualmente ao círculo azul de antes, mas apontando
    pra direção do deslocamento.

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

/** Desloca o ponto de câmera pra cima na tela, pra a posição real ficar mais
    perto da base — sobra mais mapa mostrando o que vem PELA FRENTE (câmera
    de navegação estilo Waze). Só faz sentido com o mapa girando: "pra cima"
    só é "pra frente" quando o rumo está alinhado com o topo da tela. */
function pontoComOffsetDeCamera(latlng) {
  if (!rotacaoDoMapaAtiva || !mapa) return latlng;
  try {
    const tamanho = mapa.getSize();
    const pontoTela = mapa.latLngToContainerPoint(latlng);
    const deslocado = pontoTela.subtract([0, tamanho.y * FRACAO_OFFSET_CAMERA_Y]);
    return mapa.containerPointToLatLng(deslocado);
  } catch {
    return latlng;
  }
}

function desenharPosicaoAtual(lat, lng, precisaoM, quandoMs) {
  let deslocamentoM = null;
  if (posicaoAnterior) {
    deslocamentoM = distanciaMetros(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);

    // Só aceita um novo rumo com evidência real de movimento: deslocamento
    // mínimo (escalado pela imprecisão do GPS — perto de casa, com GPS
    // ruim, 4m é só ruído) E velocidade estimada acima do "andando parado
    // no lugar". Sem isso, GPS parado oscilando alguns metros ficava
    // recalculando rumo à toa e o mapa "girava sozinho".
    const intervaloS = posicaoAnterior.quando != null && quandoMs != null
      ? Math.max((quandoMs - posicaoAnterior.quando) / 1000, 0.001)
      : null;
    const velocidadeEstimada = intervaloS ? deslocamentoM / intervaloS : null;
    const deslocamentoMinimo = Math.max(DISTANCIA_MINIMA_PARA_RUMO_M, (precisaoM || 0) * FATOR_MARGEM_PRECISAO_RUMO);
    const pareceMovimentoReal = deslocamentoM >= deslocamentoMinimo
      && (velocidadeEstimada === null || velocidadeEstimada >= VELOCIDADE_MINIMA_PARA_RUMO_MS);

    if (pareceMovimentoReal) {
      const rumoObservado = calcularRumo(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);
      // Suaviza por média circular em vez de trocar de rumo de uma vez —
      // amortece ruído sem travar a resposta a uma curva de verdade.
      rumoAtual = rumoAtual === null ? rumoObservado : suavizarAnguloCircular(rumoAtual, rumoObservado, PESO_RUMO_NOVO);
    }
  }
  posicaoAnterior = { lat, lng, quando: quandoMs };

  if (!marcadorPosicaoAtual) {
    marcadorPosicaoAtual = L.marker([lat, lng], {
      icon: iconeDirecional(rumoAtual || 0),
      zIndexOffset: 1000,
      interactive: false
    }).addTo(mapa);
    if (!rotacaoDoMapaAtiva) animadorSeta.definirImediatamente(rumoAtual || 0);
  } else {
    marcadorPosicaoAtual.setLatLng([lat, lng]);
    if (rumoAtual !== null && !rotacaoDoMapaAtiva) {
      animadorSeta.irPara(rumoAtual);
    }
  }

  // Câmera acompanha a posição (só quando a pessoa não arrastou o mapa por
  // conta própria) — e só quando o deslocamento vale a pena, pra não ficar
  // reajustando a câmera por ruído do GPS enquanto a pessoa está parada.
  const primeiraLeitura = deslocamentoM === null;
  const deslocouOSuficiente = primeiraLeitura || deslocamentoM >= DISTANCIA_MINIMA_PARA_SEGUIR_M;
  if (seguindoAutomaticamente && deslocouOSuficiente) {
    mapa.panTo(pontoComOffsetDeCamera([lat, lng]), { animate: true, duration: 0.5 });
  }

  // Gira o mapa pra manter o rumo sempre "pra cima" — só quando a pessoa não
  // tirou o controle da câmera arrastando o mapa (mesma regra do panTo
  // acima), sempre pelo caminho angular mais curto (animadorBearing).
  if (rotacaoDoMapaAtiva && seguindoAutomaticamente && rumoAtual !== null) {
    animadorBearing.irPara(rumoAtual);
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
  // navegação deixou. Anima pelo caminho mais curto, igual ao resto.
  if (rotacaoDoMapaAtiva && mapa) animadorBearing.irPara(0);
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
  const aoClicar = (e) => processarPosicao(e.latlng.lat, e.latlng.lng, 10, Date.now());
  mapa.on('click', aoClicar);
  pararSimulacao = () => mapa.off('click', aoClicar);
}

/* --------------------------------------------------------------- Limpeza --- */
window.addEventListener('beforeunload', () => { pararAcompanhamento?.(); });
