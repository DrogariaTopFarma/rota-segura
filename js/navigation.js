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
import { abrirModal, fecharModal, toast, distanciaMetros, escapar } from './ui.js';
import { APP_CONFIG } from './config.js';
import { supabase } from './supabase.js';
import { obterLinkDeCompartilhamento } from './emergency.js';
import { falar, pararFala, vozLigada, alternarVoz, vozSuportada } from './voice.js';
import { icone } from './icons.js';

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

// Navegação por voz: duas chamadas por manobra — um aviso com antecedência
// (dá tempo de reagir andando) e um bem em cima da hora (a manobra em si).
const DISTANCIA_AVISO_VOZ_M = 150;
const DISTANCIA_IMEDIATA_VOZ_M = 30;

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

// Navegação por voz: passos vêm do OpenRouteService (via calcular-rota),
// já em português — nunca inventamos o texto da manobra por conta própria.
let rotaPassos = [];        // [{ instrucao, distanciaM, indiceInicio, indiceFim }]
let passoAtualIndex = 0;
let avisoLongeFeito = false; // já anunciou "em X metros, ..." pro passo atual?
let avisoPertoFeito = false; // já anunciou a manobra em si (bem perto) pro passo atual?

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

// O leaflet-rotate gira o MAPA no sentido oposto ao rumo (setBearing(45) faz
// o norte real aparecer a 45° na tela, não a -45°) — o inverso do que faz
// sentido pra navegação "de frente" (o rumo pra onde você anda devia
// aparecer reto pra cima, em 0°). Por isso, aqui — e só aqui, num lugar só —
// o rumo é convertido pro sentido que o plugin espera (360 - rumo) antes de
// chamar setBearing. Todo o resto do arquivo (irPara/definirImediatamente)
// continua trabalhando só com "rumo" de verdade (0°=norte, sentido horário),
// sem se preocupar com essa inversão.
const animadorBearing = criarAnimadorAngular((graus) => {
  const bearingLeaflet = ((360 - graus) % 360 + 360) % 360;
  mapa?.setBearing(bearingLeaflet);
});
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

/** Mesma ideia de distanciaRestanteNaRota, mas parando num ÍNDICE específico
    da geometria em vez de ir até o fim da rota — usada pela voz pra saber
    "quanto falta até a PRÓXIMA manobra", não até o destino. */
function distanciaAtePontoNaRota(indice, t, indiceAlvo) {
  if (indiceAlvo <= indice) return 0;
  const [aLat, aLng] = rotaGeometria[indice];
  const [bLat, bLng] = rotaGeometria[indice + 1];
  let restante = distanciaMetros(
    aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t,
    bLat, bLng
  );
  for (let i = indice + 1; i < indiceAlvo; i++) {
    const [x1, y1] = rotaGeometria[i];
    const [x2, y2] = rotaGeometria[i + 1];
    restante += distanciaMetros(x1, y1, x2, y2);
  }
  return restante;
}

/** Arredonda pra dezena mais próxima (150, 140, 130...) — falar "em 147
    metros" soa robótico e sugere uma precisão que o GPS não tem de verdade. */
function arredondarParaDezena(metros) {
  return Math.max(10, Math.round(metros / 10) * 10);
}

/** Decide se é hora de anunciar (voz + texto na tela) o próximo passo da
    rota, a partir de onde a pessoa está agora (mesmo índice/fração que
    encontrarPontoMaisProximoNaRota devolve). Cada passo é anunciado no
    máximo duas vezes: uma com antecedência ("em 150 m, vire...") e uma bem
    em cima da manobra ("vire...") — nunca repete o mesmo aviso.  */
function processarInstrucaoDeVoz(indice, t) {
  if (!rotaPassos.length) return;

  // Avança pro passo certo conforme a posição avança — nunca volta (a rota
  // só anda pra frente). Reseta os avisos a cada passo novo.
  while (
    passoAtualIndex < rotaPassos.length - 1 &&
    rotaPassos[passoAtualIndex + 1].indiceInicio <= indice
  ) {
    passoAtualIndex++;
    avisoLongeFeito = false;
    avisoPertoFeito = false;
  }

  const passo = rotaPassos[passoAtualIndex];
  if (!passo) return;

  const distanciaAteManobra = distanciaAtePontoNaRota(indice, t, passo.indiceFim);
  atualizarBannerDeInstrucao(passo, distanciaAteManobra);

  if (!avisoLongeFeito && distanciaAteManobra <= DISTANCIA_AVISO_VOZ_M) {
    avisoLongeFeito = true;
    // Passo curto (a manobra já está pertinho): pula direto pro aviso final,
    // sem falar "em 20 metros" e "agora" quase juntos.
    if (distanciaAteManobra <= DISTANCIA_IMEDIATA_VOZ_M) {
      avisoPertoFeito = true;
      falar(passo.instrucao);
    } else {
      falar(`Em ${arredondarParaDezena(distanciaAteManobra)} metros, ${passo.instrucao.toLowerCase()}.`);
    }
    return;
  }
  if (!avisoPertoFeito && distanciaAteManobra <= DISTANCIA_IMEDIATA_VOZ_M) {
    avisoPertoFeito = true;
    falar(passo.instrucao);
  }
}

/** Texto sempre visível com a próxima manobra — reforça (e sobrevive a) a
    voz: celular no silencioso, alto-falante ruim na rua, ou só preferência
    de ler em vez de ouvir. Escondido quando a rota não tem passos (fonte de
    rota antiga, por exemplo — nunca quebra por falta do dado). */
function atualizarBannerDeInstrucao(passo, distanciaAteManobra) {
  const banner = document.getElementById('navegacao-instrucao');
  if (!banner) return;
  banner.hidden = false;
  banner.innerHTML = `
    <div class="navegacao-instrucao__distancia">${formatarDistancia(distanciaAteManobra)}</div>
    <div class="navegacao-instrucao__texto">${escapar(passo.instrucao)}</div>`;
}

/** Reflete o estado ligado/desligado no botão (ícone + aria-pressed) — some
    o botão inteiro se o navegador não suportar síntese de voz, em vez de
    mostrar um controle que não faz nada. */
function atualizarBotaoDeVoz() {
  const botao = document.getElementById('navegacao-voz');
  if (!botao) return;
  if (!vozSuportada()) { botao.hidden = true; return; }
  const ligada = vozLigada();
  botao.hidden = false;
  botao.setAttribute('aria-pressed', String(ligada));
  botao.setAttribute('aria-label', ligada ? 'Desligar narração por voz' : 'Ligar narração por voz');
  botao.innerHTML = icone(ligada ? 'som' : 'semSom', 20);
}

/** Estimativa de rumo pra usar ANTES de ter qualquer deslocamento real do
    GPS — sem isso, o mapa começava a navegação sempre norte-pra-cima e só
    girava depois que a pessoa andasse alguns metros, o que não é como um
    app de navegação de verdade se comporta (Waze/Google Maps já começam
    "de frente"). Usa a própria geometria da rota: procura, a partir da
    origem, o primeiro ponto longe o bastante pra dar uma direção estável
    (evita ruído de pontos muito próximos na geometria) e calcula o rumo até
    lá. É só o CHUTE do primeiríssimo quadro — a partir da leitura seguinte,
    quem assume é direcaoDaRota (abaixo), que já é a lógica "normal". */
function rumoInicialDaRota(lat, lng) {
  if (!rotaGeometria || rotaGeometria.length < 2) return null;
  const DISTANCIA_MINIMA_M = 8;
  for (const [pLat, pLng] of rotaGeometria) {
    if (distanciaMetros(lat, lng, pLat, pLng) >= DISTANCIA_MINIMA_M) {
      return calcularRumo(lat, lng, pLat, pLng);
    }
  }
  // Rota inteira mais curta que a distância mínima (raro): usa o último
  // ponto mesmo assim, é melhor que não ter rumo nenhum.
  const ultimo = rotaGeometria[rotaGeometria.length - 1];
  return calcularRumo(lat, lng, ultimo[0], ultimo[1]);
}

/** Direção da PRÓPRIA ROTA a partir de um ponto nela (índice do segmento +
    fração já percorrida — o mesmo formato que encontrarPontoMaisProximoNaRota
    devolve). Usada continuamente, a cada leitura de GPS em que a posição
    está perto o bastante da rota pra ser "encaixada" nela: é isso que
    garante que o trecho bem na frente do pino sempre aparece RETO na tela
    (alinhado com "pra cima"), em vez de torto — porque o ângulo do mapa
    passa a ser exatamente o ângulo desse trecho, não uma estimativa feita a
    partir de duas leituras brutas e ruidosas do GPS (que raramente caem
    exatamente em cima da rua, e por isso apontavam torto). */
function direcaoDaRota(indice, t) {
  const DISTANCIA_MINIMA_M = 8;
  const [aLat, aLng] = rotaGeometria[indice];
  const [bLat, bLng] = rotaGeometria[indice + 1];
  const lat = aLat + (bLat - aLat) * t;
  const lng = aLng + (bLng - aLng) * t;
  for (let i = indice; i < rotaGeometria.length - 1; i++) {
    const [pLat, pLng] = rotaGeometria[i + 1];
    if (distanciaMetros(lat, lng, pLat, pLng) >= DISTANCIA_MINIMA_M) {
      return calcularRumo(lat, lng, pLat, pLng);
    }
  }
  const ultimo = rotaGeometria[rotaGeometria.length - 1];
  return calcularRumo(lat, lng, ultimo[0], ultimo[1]);
}

/* ========================================================================== */

/**
 * @param {object} args
 * @param {L.Map} args.mapa - mapa já criado pela Tela 2 (não cria um novo)
 * @param {{lat:number,lng:number,nome:string,fonte:'gps'|'manual'}} args.origem
 * @param {{lat:number,lng:number,nome:string}} args.destino
 * @param {{distanciaM:number,duracaoS:number,geometria:number[][],passos?:Array<{instrucao:string,distanciaM:number,indiceInicio:number,indiceFim:number}>}} args.rota
 * @param {() => void} args.aoSair - chamado quando a navegação termina (chegada, encerrar ou escolher outra rota)
 */
export function iniciarNavegacao({ mapa: mapaRecebido, origem, destino, rota, aoSair }) {
  mapa = mapaRecebido;
  rotaGeometria = rota.geometria;
  rotaInfo = { distanciaM: rota.distanciaM, duracaoS: rota.duracaoS };
  rotaPassos = rota.passos || [];
  destinoAtual = destino;
  aoSairCallback = aoSair;

  navegacaoAtiva = true;
  desdeQuandoPareceForaDaRota = null;
  jaAvisouSaida = false;
  conectouNaRota = false;
  seguindoAutomaticamente = true;
  posicaoAnterior = null;
  rumoAtual = null;
  passoAtualIndex = 0;
  avisoLongeFeito = false;
  avisoPertoFeito = false;

  document.getElementById('painel-navegacao').hidden = false;
  document.getElementById('navegacao-destino').textContent = `Indo para ${destino.nome}`;
  atualizarBotaoDeVoz();

  // Existe mais de um botão de recentralizar na tela (um flutuante por cima
  // do mapa, outro na fileira de ações rápidas da folha) — os dois fazem
  // exatamente a mesma coisa, então dividem a mesma classe e o mesmo handler
  // em vez de duplicar a lógica por id.
  const aoClicarRecentralizar = () => {
    seguindoAutomaticamente = true;
    if (marcadorPosicaoAtual) {
      mapa.setView(pontoComOffsetDeCamera(marcadorPosicaoAtual.getLatLng()), APP_CONFIG.zoomNavegacao, { animate: true });
      // Recentralizar também devolve a orientação "de frente" (rumo pra
      // cima), não só a posição — senão a pessoa via a câmera voltar pro
      // lugar certo mas ainda torta, do jeito que ela tinha deixado ao girar
      // o mapa manualmente. Sempre pelo caminho mais curto (animadorBearing).
      if (rotacaoDoMapaAtiva && rumoAtual !== null) animadorBearing.irPara(rumoAtual);
    }
  };
  document.querySelectorAll('.acao-recentralizar').forEach((botao) => { botao.onclick = aoClicarRecentralizar; });
  document.getElementById('navegacao-encerrar').onclick = () => abrirModal('modal-encerrar-rota');
  document.getElementById('navegacao-colapsar').onclick = () => abrirModal('modal-encerrar-rota');
  document.getElementById('navegacao-opcoes').onclick = () => abrirModal('modal-opcoes-rota');
  document.getElementById('navegacao-compartilhar').onclick = compartilharRota;
  const botaoVoz = document.getElementById('navegacao-voz');
  if (botaoVoz) botaoVoz.onclick = () => { alternarVoz(); atualizarBotaoDeVoz(); };
  ligarBotoesDosModais();
  ligarDetectorDeArrasto();

  // Acompanhamento real (GPS de verdade) sempre — mesmo quando a partida foi
  // digitada à mão em vez de vir do GPS. Digitar o endereço de partida é só
  // um jeito de conferir/corrigir de onde você está partindo; a partir do
  // momento que a navegação começa, o acompanhamento segue o GPS de verdade.
  //
  // Chuta um rumo inicial a partir da própria rota, ANTES de qualquer
  // leitura real de GPS — sem isso, a navegação sempre começava norte-pra-
  // cima e só virava "de frente" depois de andar alguns metros. Girado sem
  // animação (definirImediatamente): é o primeiro quadro da navegação,
  // ainda não tem "de onde" animar.
  rumoAtual = rumoInicialDaRota(origem.lat, origem.lng);
  if (rotacaoDoMapaAtiva && rumoAtual !== null) animadorBearing.definirImediatamente(rumoAtual);

  // Já entra no zoom de acompanhamento (mais perto que a visão geral da
  // rota que a Tela 2 deixou no mapa) — depois disso, panTo só recentraliza,
  // sem forçar zoom de novo a cada leitura.
  mapa.setView(pontoComOffsetDeCamera([origem.lat, origem.lng]), APP_CONFIG.zoomNavegacao, { animate: true });
  desenharPosicaoAtual(origem.lat, origem.lng, null, Date.now());
  atualizarProgresso(distanciaMetros(origem.lat, origem.lng, destino.lat, destino.lng));

  // Primeira instrução já ao iniciar (não espera a primeira leitura de GPS
  // chegar) — é assim que um app de navegação de verdade se comporta: você
  // já sabe pra onde ir antes de dar o primeiro passo.
  if (rotaGeometria && rotaGeometria.length >= 2 && rotaPassos.length) {
    const inicial = encontrarPontoMaisProximoNaRota(origem.lat, origem.lng);
    processarInstrucaoDeVoz(inicial.indice, inicial.t);
  }

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
    // Só anuncia manobra com a posição CONFIÁVEL na rota — fora dela
    // (limiteEfetivo ultrapassado) não dá pra saber com segurança qual é o
    // próximo passo de verdade.
    processarInstrucaoDeVoz(indice, t);
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

/** Pino com seta na cor de marca do Rota Segura (rosa-magenta), com um halo
    suave pulsando ao redor — visual de "ponto vivo" de apps de navegação de
    verdade —, apontando pra direção do deslocamento.

    Quando o mapa em si já gira pro rumo (rotacaoDoMapaAtiva), a seta fica
    sempre reta pra cima — "pra cima" já É a direção do trajeto, então girar
    a seta também giraria ela duas vezes. Só gira a seta sozinha no fallback
    sem suporte a rotação de mapa (mapa fica parado, seta aponta o rumo). */
function iconeDirecional(rumoGraus) {
  const angulo = rotacaoDoMapaAtiva ? 0 : Math.round(rumoGraus);
  return L.divIcon({
    html: `<div class="navegacao-marcador">
        <div class="navegacao-marcador__halo"></div>
        <div class="navegacao-seta" style="transform: rotate(${angulo}deg)">
          <svg width="46" height="46" viewBox="0 0 46 46">
            <circle cx="23" cy="23" r="18" fill="#E83D67" stroke="#FFFFFF" stroke-width="4"/>
            <path d="M23 11 L31 34 L23 28.5 L15 34 Z" fill="#FFFFFF"/>
          </svg>
        </div>
      </div>`,
    className: '',
    iconSize: [70, 70],
    iconAnchor: [35, 35]
  });
}

/** Desloca o ponto de câmera pra cima na tela, pra a posição real ficar mais
    perto da base — sobra mais mapa mostrando o que vem PELA FRENTE (câmera
    de navegação estilo Waze). Só faz sentido com o mapa girando: "pra cima"
    só é "pra frente" quando o rumo está alinhado com o topo da tela.

    O deslocamento é calculado em cima da altura REALMENTE visível do mapa —
    ou seja, descontando a folha de navegação e o aviso de SOS flutuantes na
    parte de baixo da tela — e não da altura total da tela. Sem isso, com a
    folha nova (bem mais alta que o card antigo), a conta empurrava o pino
    pra trás dela, escondido: a fração equivalia a mais da metade da área
    visível de verdade. Quando não há nada flutuando por baixo (fora da
    navegação), o resultado é idêntico ao de antes. */
function pontoComOffsetDeCamera(latlng) {
  if (!rotacaoDoMapaAtiva || !mapa) return latlng;
  try {
    const tamanho = mapa.getSize();
    const folha = document.getElementById('painel-navegacao');
    const emNavegacao = !!(folha && !folha.hidden);
    let alturaReservada = 0;
    if (emNavegacao) {
      alturaReservada += folha.getBoundingClientRect().height;
      const sos = document.getElementById('rota-sos');
      if (sos) alturaReservada += sos.getBoundingClientRect().height;
    }
    const alturaVisivel = Math.max(tamanho.y - alturaReservada, 1);
    const alvoY = alturaVisivel * (0.5 + FRACAO_OFFSET_CAMERA_Y);

    const pontoTela = mapa.latLngToContainerPoint(latlng);
    const deslocado = pontoTela.subtract([0, alvoY - tamanho.y / 2]);
    return mapa.containerPointToLatLng(deslocado);
  } catch {
    return latlng;
  }
}

function desenharPosicaoAtual(lat, lng, precisaoM, quandoMs) {
  let deslocamentoM = null;
  let rumoObservado = null;
  let pareceMovimentoReal = false;

  if (posicaoAnterior) {
    deslocamentoM = distanciaMetros(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);

    // Só aceita um novo rumo (bruto do GPS) com evidência real de
    // movimento: deslocamento mínimo (escalado pela imprecisão do GPS —
    // perto de casa, com GPS ruim, 4m é só ruído) E velocidade estimada
    // acima do "andando parado no lugar". Sem isso, GPS parado oscilando
    // alguns metros ficava recalculando rumo à toa e o mapa "girava
    // sozinho".
    const intervaloS = posicaoAnterior.quando != null && quandoMs != null
      ? Math.max((quandoMs - posicaoAnterior.quando) / 1000, 0.001)
      : null;
    const velocidadeEstimada = intervaloS ? deslocamentoM / intervaloS : null;
    const deslocamentoMinimo = Math.max(DISTANCIA_MINIMA_PARA_RUMO_M, (precisaoM || 0) * FATOR_MARGEM_PRECISAO_RUMO);
    pareceMovimentoReal = deslocamentoM >= deslocamentoMinimo
      && (velocidadeEstimada === null || velocidadeEstimada >= VELOCIDADE_MINIMA_PARA_RUMO_MS);

    if (pareceMovimentoReal) rumoObservado = calcularRumo(posicaoAnterior.lat, posicaoAnterior.lng, lat, lng);
  }
  posicaoAnterior = { lat, lng, quando: quandoMs };

  // Acha o ponto mais próximo da rota UMA VEZ só — usado tanto pra decidir
  // a posição MOSTRADA (encaixada na via, não flutuando ao lado por ruído
  // de GPS) quanto pro RUMO (a direção da própria rota nesse ponto, que é o
  // que garante o trecho na frente do pino sempre reto — ver direcaoDaRota).
  // Mesma régua de distância do "saiu da rota": se passou do limite
  // efetivo, nenhum dos dois é ajustado — um app de segurança não pode
  // fingir que você está no caminho quando não está.
  let latExibido = lat, lngExibido = lng;
  if (rotaGeometria && rotaGeometria.length >= 2) {
    const encaixe = encontrarPontoMaisProximoNaRota(lat, lng);
    const limiteEfetivo = Math.min(
      LIMITE_MAXIMO_EFETIVO_M,
      LIMITE_BASE_FORA_DA_ROTA_M + (precisaoM || 0) * FATOR_MARGEM_PRECISAO
    );
    if (encaixe.dist <= limiteEfetivo) {
      const [aLat, aLng] = rotaGeometria[encaixe.indice];
      const [bLat, bLng] = rotaGeometria[encaixe.indice + 1];
      latExibido = aLat + (bLat - aLat) * encaixe.t;
      lngExibido = aLng + (bLng - aLng) * encaixe.t;

      const rumoDaRota = direcaoDaRota(encaixe.indice, encaixe.t);
      rumoAtual = rumoAtual === null ? rumoDaRota : suavizarAnguloCircular(rumoAtual, rumoDaRota, PESO_RUMO_NOVO);
    } else if (pareceMovimentoReal) {
      // Fora da rota: não tem "direção da via" pra seguir — usa o rumo bruto
      // do deslocamento real mesmo, é a melhor informação disponível aqui.
      rumoAtual = rumoAtual === null ? rumoObservado : suavizarAnguloCircular(rumoAtual, rumoObservado, PESO_RUMO_NOVO);
    }
  } else if (pareceMovimentoReal) {
    rumoAtual = rumoAtual === null ? rumoObservado : suavizarAnguloCircular(rumoAtual, rumoObservado, PESO_RUMO_NOVO);
  }

  if (!marcadorPosicaoAtual) {
    marcadorPosicaoAtual = L.marker([latExibido, lngExibido], {
      icon: iconeDirecional(rumoAtual || 0),
      zIndexOffset: 1000,
      interactive: false
    }).addTo(mapa);
    if (!rotacaoDoMapaAtiva) animadorSeta.definirImediatamente(rumoAtual || 0);
  } else {
    marcadorPosicaoAtual.setLatLng([latExibido, lngExibido]);
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
    mapa.panTo(pontoComOffsetDeCamera([latExibido, lngExibido]), { animate: true, duration: 0.5 });
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
    novo para o OpenRouteService durante a navegação (regra do Bloco 2). A
    "chegada prevista" é só esse mesmo tempo estimado somado ao horário
    atual, mostrado como hora do relógio em vez de uma contagem regressiva —
    o rótulo "(estimativa)" continua explícito, pelo mesmo motivo de sempre:
    nunca fingir uma precisão que a rota não tem. */
function atualizarProgresso(distanciaM, { rotulo = 'estimativa' } = {}) {
  const ritmoSPorM = rotaInfo.duracaoS / Math.max(rotaInfo.distanciaM, 1);
  const tempoS = distanciaM * ritmoSPorM;
  document.getElementById('navegacao-tempo').textContent = formatarDuracao(tempoS);
  document.getElementById('navegacao-distancia').textContent = formatarDistancia(distanciaM);

  const chegada = new Date(Date.now() + tempoS * 1000);
  const hh = String(chegada.getHours()).padStart(2, '0');
  const mm = String(chegada.getMinutes()).padStart(2, '0');
  document.getElementById('navegacao-chegada').textContent = `${hh}:${mm} (${rotulo})`;
}

/* ---------------------------------------------------- Fim da navegação --- */
function finalizarPorChegada() {
  // Encerra tudo já ao detectar a chegada (GPS, marcador, volta à Tela 2) — o
  // aviso abaixo é só uma confirmação por cima, não uma condição para isso
  // acontecer. Assim, fechar o aviso sem tocar em "Concluir" (Esc, clique
  // fora) não deixa a navegação numa tela morta.
  falar('Você chegou ao seu destino.');
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
  const banner = document.getElementById('navegacao-instrucao');
  if (banner) banner.hidden = true;
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
    pararFala();
    encerrar();
  };
  // O encerramento em si já aconteceu assim que a chegada foi detectada
  // (finalizarPorChegada) — aqui só fecha o aviso. Não corta a fala: é aqui
  // que "Você chegou ao seu destino" ainda está tocando.
  document.getElementById('btn-concluir-chegada').onclick = () => {
    fecharModal('modal-chegada');
  };
  document.getElementById('btn-confirmar-encerrar').onclick = () => {
    fecharModal('modal-encerrar-rota');
    pararFala();
    encerrar();
  };
  // "Opções da rota": trocar de caminho volta pro planejamento (mesmo
  // destino, mesma origem, pra escolher outra rota/modo); encerrar reaproveita
  // a mesma confirmação do botão de encerrar normal, sem duplicar o fluxo.
  document.getElementById('btn-trocar-rota').onclick = () => {
    fecharModal('modal-opcoes-rota');
    pararFala();
    encerrar();
  };
  document.getElementById('btn-opcoes-encerrar').onclick = () => {
    fecharModal('modal-opcoes-rota');
    abrirModal('modal-encerrar-rota');
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
