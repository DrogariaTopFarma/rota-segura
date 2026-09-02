/* ============================================================================
   ROTA SEGURA — Tela 2: planejamento de rota (Bloco 2)

   Fluxo: origem vem do GPS sozinha (igual ao seletor de local do Bloco 1),
   destino é pesquisado (reaproveita a mesma busca de endereço da Tela 1, já
   com reconhecimento de rua + número). Ao ter os dois pontos, calcula a rota
   chamando a Edge Function "calcular-rota" (que fala com o OpenRouteService
   escondendo a chave) e anota o card só com dados reais do banco — nunca
   inventa iluminação/movimento que não existam.
   ============================================================================ */

import { exigirLogin } from './auth.js';
import { aplicarIcones, icone, pinoMapa } from './icons.js';
import { prepararModais, abrirModal, toast, escapar, debounce, distanciaMetros } from './ui.js';
import { obterPosicao, mensagemDoMotivo } from './geolocation.js';
import { buscarEndereco, enderecoDeCoordenadas } from './geocoding.js';
import { supabase } from './supabase.js';
import { APP_CONFIG, CARTO_API_KEY } from './config.js';
import { obterLinkDeEmergencia } from './emergency.js';
import { iniciarNavegacao } from './navigation.js';
import { marcarItemAtivo } from './nav.js';
import { ROTULOS_RELATO, ICONE_POR_TIPO_RELATO, corDoRelato } from './map.js';
import { registrarServiceWorker } from './pwa.js';

// Mesmas cores/ícones do mapa da Tela 1 (map.js), para os marcadores ao
// longo da rota serem reconhecíveis nas duas telas.
const ICONE_CONTEXTO = {
  ponto_apoio: () => divIconContexto('escudo', '#4CAF7D'),
  hospital: () => divIconContexto('hospital', '#4CAF7D'),
  farmacia: () => divIconContexto('hospital', '#4CAF7D'),
  comercio_24h: () => divIconContexto('predio', '#7C5CBF'),
  ponto_onibus: () => divIconContexto('onibus', '#7C5CBF'),
  delegacia: () => divIconContexto('predio', '#7C5CBF')
};
// Um L.divIcon é imutável e pode ser reaproveitado em vários marcadores —
// evita remontar a mesma string SVG do zero a cada marcador desenhado.
const cacheDeIcones = new Map();
function divIconContexto(nomeIcone, cor) {
  const chave = `${nomeIcone}:${cor}`;
  if (!cacheDeIcones.has(chave)) {
    cacheDeIcones.set(chave, L.divIcon({
      html: pinoMapa(nomeIcone, cor),
      className: '',
      iconSize: [28, 34],
      iconAnchor: [14, 33],
      popupAnchor: [0, -30]
    }));
  }
  return cacheDeIcones.get(chave);
}

let mapa = null;
let camadaContexto = null; // relatos/pontos de apoio/delegacias perto da rota calculada
let marcadorOrigem = null;
let marcadorDestino = null;
let linhaRota = null;

let origem = null;    // { lat, lng, nome, fonte: 'gps' | 'manual' }
let destino = null;   // { lat, lng, nome }
let rotaAtual = null; // { distanciaM, duracaoS, geometria, passos }
let tokenRota = 0;    // evita que uma resposta atrasada sobrescreva uma mais nova
let tokenOrigem = 0;  // evita que uma leitura de GPS atrasada sobrescreva uma origem escolhida à mão
let perfil = 'foot-walking'; // 'foot-walking' | 'driving-car'

/* ------------------------------------------------------------ Inicializar */
async function iniciar() {
  aplicarIcones();
  registrarServiceWorker('../sw.js');
  const usuario = await exigirLogin();
  if (!usuario) return;

  prepararModais();
  marcarItemAtivo();
  garantirMapa();

  if (new URLSearchParams(location.search).get('simular') === '1') {
    document.getElementById('faixa-teste').hidden = false;
  }

  document.getElementById('rota-voltar')?.addEventListener('click', () => {
    window.location.href = 'mapa.html';
  });
  document.getElementById('rota-atualizar-origem')?.addEventListener('click', () => buscarOrigemAtual());
  document.getElementById('rota-inverter')?.addEventListener('click', inverterOrigemDestino);
  document.getElementById('rota-sos-botao')?.addEventListener('click', acionarSos);
  prepararSeletorDeModo();
  document.getElementById('botao-central')?.addEventListener('click', () => {
    toast('Para cadastrar, volte à tela do Mapa.', 'info');
    window.location.href = 'mapa.html';
  });

  prepararBuscas();
  await buscarOrigemAtual({ automatico: true });
}

document.addEventListener('DOMContentLoaded', iniciar);

/* ------------------------------------------------- Meio de transporte --- */
function prepararSeletorDeModo() {
  const botoes = [document.getElementById('rota-modo-pe'), document.getElementById('rota-modo-carro')];
  botoes.forEach((botao) => {
    botao?.addEventListener('click', () => {
      if (botao.dataset.perfil === perfil) return; // já é o modo atual
      perfil = botao.dataset.perfil;
      botoes.forEach((b) => b?.setAttribute('aria-pressed', String(b === botao)));
      tentarCalcularRota();
    });
  });
}

/* -------------------------------------------------------------- Mapa --- */
function garantirMapa() {
  if (mapa) return mapa;
  mapa = L.map('rota-mapa', {
    zoomControl: true,
    attributionControl: true,
    // SVG (o padrão do Leaflet), não canvas: o único vetor desenhado aqui é
    // a linha da rota, e o renderizador canvas tem problema conhecido de
    // redesenho quando combinado com rotação de mapa (leaflet-rotate) e uma
    // mudança de tamanho do contêiner — exatamente o que passou a acontecer
    // ao iniciar a navegação (mapa vira tela cheia). SVG é elemento de DOM
    // de verdade, então acompanha a rotação/redimensionamento sem precisar
    // de um redesenho manual.
    // Capacidade de girar o mapa (câmera "de frente" durante a navegação —
    // ver navigation.js). Fica parado em 0° (norte pra cima) até a navegação
    // de verdade começar a girar sozinha pelo rumo do GPS; sem rotação
    // manual por gesto (touchRotate:false), pra nunca brigar com o giro
    // automático nem com o pinça-pra-zoom.
    rotate: true,
    rotateControl: false,
    bearing: 0,
    touchRotate: false,
    zoomAnimation: false
  }).setView(APP_CONFIG.centroPadrao, APP_CONFIG.zoomPadrao);
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`, {
    subdomains: 'abcd',
    maxZoom: 20,
    detectRetina: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(mapa);
  camadaContexto = L.layerGroup().addTo(mapa);
  return mapa;
}

function bboxDoMapa() {
  const b = mapa.getBounds();
  return { oeste: b.getWest(), sul: b.getSouth(), leste: b.getEast(), norte: b.getNorth() };
}

function ajustarEnquadramento() {
  const pontos = [];
  if (origem) pontos.push([origem.lat, origem.lng]);
  if (destino) pontos.push([destino.lat, destino.lng]);
  if (pontos.length === 2) mapa.fitBounds(pontos, { padding: [40, 40] });
  else if (pontos.length === 1) mapa.setView(pontos[0], APP_CONFIG.zoomBusca);
}

function desenharOrigem() {
  if (!origem) return;
  if (marcadorOrigem) mapa.removeLayer(marcadorOrigem);
  if (origem.fonte === 'manual') {
    // Endereço digitado: pino igual ao do destino, só que azul — deixa claro
    // que não é a mesma coisa que "aqui é onde você está agora".
    marcadorOrigem = L.marker([origem.lat, origem.lng], {
      icon: L.divIcon({
        html: pinoMapa('mira', '#2F6BFF'),
        className: '',
        iconSize: [28, 34],
        iconAnchor: [14, 33]
      })
    }).addTo(mapa).bindPopup('<div class="popup__tipo">Partida (endereço digitado)</div>');
  } else {
    marcadorOrigem = L.circleMarker([origem.lat, origem.lng], {
      radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#2F6BFF', fillOpacity: 1
    }).addTo(mapa).bindPopup('<div class="popup__tipo">Minha localização atual</div>');
  }
  ajustarEnquadramento();
}

function desenharDestino() {
  if (!destino) return;
  if (marcadorDestino) mapa.removeLayer(marcadorDestino);
  marcadorDestino = L.marker([destino.lat, destino.lng], {
    icon: L.divIcon({
      html: pinoMapa('bandeira', '#E83D67'),
      className: '',
      iconSize: [28, 34],
      iconAnchor: [14, 33]
    })
  }).addTo(mapa).bindPopup(`<div class="popup__tipo">${escapar(destino.nome)}</div>`);
  ajustarEnquadramento();
}

/* -------------------------------------------------- Busca (origem e destino) --- */
/** Liga um campo de texto a sugestões de endereço — usado tanto por "Meu
    local" quanto por "Destino", que precisam exatamente da mesma busca. */
function prepararCampoBusca({ input, sugestoes, aoEscolher }) {
  if (!input || !sugestoes) return;

  const buscar = debounce(async (texto) => {
    if (texto.trim().length < 3) { sugestoes.hidden = true; return; }
    try {
      const resultados = await buscarEndereco(texto, { limite: 5, area: mapa ? bboxDoMapa() : null });
      if (!resultados.length) {
        sugestoes.innerHTML = '<button type="button" disabled>Nenhum endereço encontrado.</button>';
        sugestoes.hidden = false;
        return;
      }
      sugestoes.innerHTML = resultados
        .map((r, i) => `
          <button type="button" data-i="${i}">
            <span>${escapar(r.curto)}</span>
            ${r.aproximado ? '<span class="sugestao-tag">sem número exato</span>' : ''}
          </button>`)
        .join('');
      sugestoes.hidden = false;
      sugestoes.querySelectorAll('button[data-i]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = resultados[Number(btn.dataset.i)];
          sugestoes.hidden = true;
          input.value = r.curto;
          aoEscolher(r);
        });
      });
    } catch {
      sugestoes.hidden = true;
      toast('Não foi possível buscar o endereço agora.', 'erro');
    }
  }, APP_CONFIG.debounceMs);

  input.addEventListener('input', (e) => buscar(e.target.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
}

function prepararBuscas() {
  const form = document.getElementById('form-rota');
  if (!form) return;

  prepararCampoBusca({
    input: document.getElementById('rota-origem-texto'),
    sugestoes: document.getElementById('rota-origem-sugestoes'),
    aoEscolher: (r) => {
      tokenOrigem++; // escolha manual sempre vence uma leitura de GPS atrasada
      origem = { lat: r.lat, lng: r.lng, nome: r.curto, fonte: 'manual', aproximado: r.aproximado };
      document.getElementById('rota-origem-label').textContent = 'Endereço de partida';
      desenharOrigem();
      tentarCalcularRota();
    }
  });

  prepararCampoBusca({
    input: document.getElementById('rota-destino'),
    sugestoes: document.getElementById('rota-sugestoes'),
    aoEscolher: (r) => {
      destino = { lat: r.lat, lng: r.lng, nome: r.curto, aproximado: r.aproximado };
      desenharDestino();
      tentarCalcularRota();
    }
  });

  form.addEventListener('submit', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (form.contains(e.target)) return;
    form.querySelectorAll('.sugestoes').forEach((el) => { el.hidden = true; });
  });
}

/* -------------------------------------------------------------- Origem --- */
/**
 * Busca a localização atual por GPS. Se, enquanto isso, a usuária já tiver
 * digitado uma origem à mão, a leitura de GPS (que pode levar até 15s) é
 * descartada — a escolha mais recente sempre vence. Mesma proteção contra
 * corrida já usada no seletor de local do Bloco 1 (location-picker.js).
 */
async function buscarOrigemAtual({ automatico = false } = {}) {
  const meuToken = ++tokenOrigem;
  const input = document.getElementById('rota-origem-texto');
  const label = document.getElementById('rota-origem-label');
  input.placeholder = 'Buscando localização...';

  try {
    const pos = await obterPosicao({ precisaoDesejada: 25, tempoMaximo: 15000 });
    if (meuToken !== tokenOrigem) return;
    const endereco = await enderecoDeCoordenadas(pos.lat, pos.lng);
    if (meuToken !== tokenOrigem) return;

    origem = { lat: pos.lat, lng: pos.lng, nome: endereco, fonte: 'gps' };
    input.value = endereco;
    label.textContent = 'Localização atual';
    desenharOrigem();
    tentarCalcularRota();
  } catch (erro) {
    if (meuToken !== tokenOrigem) return;
    // A opção manual continua funcionando mesmo sem GPS: deixa o campo
    // vazio, pronto pra digitar, em vez de travado numa mensagem de erro.
    input.placeholder = 'Não foi possível obter sua localização — digite um endereço';
    label.textContent = 'Endereço de partida';
    if (!automatico) {
      toast(mensagemDoMotivo(erro.motivo), 'erro', 6000);
      input.focus();
    }
  }
}

function inverterOrigemDestino() {
  if (!origem && !destino) return;
  tokenOrigem++; // invalida qualquer leitura de GPS ainda em andamento

  const antigoDestino = destino;
  // O que era destino vira origem "digitada" — destino nunca veio do GPS,
  // então isso está sempre correto, não importa de onde a origem antiga veio.
  destino = origem ? { lat: origem.lat, lng: origem.lng, nome: origem.nome, aproximado: origem.aproximado } : null;
  origem = antigoDestino
    ? { lat: antigoDestino.lat, lng: antigoDestino.lng, nome: antigoDestino.nome, fonte: 'manual', aproximado: antigoDestino.aproximado }
    : null;

  document.getElementById('rota-origem-texto').value = origem?.nome || '';
  document.getElementById('rota-origem-label').textContent = origem ? 'Endereço de partida' : 'Meu local';
  document.getElementById('rota-destino').value = destino?.nome || '';
  desenharOrigem();
  desenharDestino();
  tentarCalcularRota();
}

/* --------------------------------------------------------- Calcular rota --- */
function tentarCalcularRota() {
  if (!origem || !destino) return;
  calcularRota();
}

async function calcularRota() {
  const meuToken = ++tokenRota;
  const card = document.getElementById('rota-card');
  card.hidden = false;
  card.innerHTML = `<div class="rota-card__cabecalho">
      <span class="spinner spinner--rosa"></span>
      <span class="rota-card__titulo">Calculando rota...</span>
    </div>`;

  if (linhaRota) { mapa.removeLayer(linhaRota); linhaRota = null; }
  camadaContexto.clearLayers();

  const { data, error } = await supabase.functions.invoke('calcular-rota', {
    body: {
      origem: { lat: origem.lat, lng: origem.lng },
      destino: { lat: destino.lat, lng: destino.lng },
      perfil
    }
  });

  if (meuToken !== tokenRota) return; // uma busca mais nova já está em andamento

  // Importante: quando a Edge Function responde com um status de erro (400,
  // 404, 429, 500...), o supabase-js NÃO coloca o corpo em `data` — só em
  // `error`, e nem sempre como texto simples. Por isso a mensagem específica
  // que a função devolveu (limite atingido, chave inválida, sem rota etc.)
  // só aparece se a gente for buscá-la em `error.context`.
  if (error) {
    rotaAtual = null;
    mostrarErroRota(await extrairMensagemDeErro(error));
    return;
  }
  if (!data || data.erro) {
    rotaAtual = null;
    mostrarErroRota(data?.erro || 'Não foi possível calcular a rota neste momento. Tente novamente.');
    return;
  }

  if (!data.rotas || !data.rotas.length) {
    rotaAtual = null;
    mostrarErroRota('Não foi possível calcular a rota neste momento. Tente novamente.');
    return;
  }

  const escolha = await escolherRotaMaisSegura(data.rotas);
  if (meuToken !== tokenRota) return;

  rotaAtual = {
    distanciaM: escolha.distanciaM, duracaoS: escolha.duracaoS, geometria: escolha.geometria,
    passos: escolha.passos || []
  };
  linhaRota = L.polyline(rotaAtual.geometria, { color: '#E83D67', weight: 5, opacity: 0.9 }).addTo(mapa);
  mapa.fitBounds(linhaRota.getBounds(), { padding: [40, 40] });
  desenharContextoDaRota(escolha);

  // O aviso de "número exato não mapeado" some da lista de sugestões assim
  // que você escolhe o endereço — mantemos ele visível aqui, no card da rota,
  // pra não perder essa informação depois de escolhida.
  const avisosDeLocal = [];
  if (origem?.aproximado) {
    avisosDeLocal.push({ icone: 'pino', texto: 'A partida é aproximada — o número exato do endereço não está mapeado.' });
  }
  if (destino?.aproximado) {
    avisosDeLocal.push({ icone: 'pino', texto: 'O destino é aproximado — o número exato do endereço não está mapeado.' });
  }

  const observacoes = montarObservacoes(escolha);
  // Só afirma que "evitou" relatos quando havia de fato outra opção pior —
  // com uma rota só (ORS às vezes não acha alternativa nenhuma), não haveria
  // nada pra comparar, e a frase seria uma promessa vazia.
  if (escolha.eraAMaisRapida === false) {
    observacoes.unshift({
      icone: 'escudo',
      texto: 'Entre os caminhos calculados, este foi o que passa perto de menos relatos — por isso não é o mais rápido.'
    });
  }

  desenharCardRota(rotaAtual, [...avisosDeLocal, ...observacoes]);
  salvarHistoricoRota(rotaAtual).catch((erro) => console.error('Não foi possível salvar o histórico da rota:', erro));
}

/** Lê a mensagem em português que a Edge Function devolveu no corpo do erro
    (quando ela responde com um status diferente de 2xx). */
async function extrairMensagemDeErro(error) {
  try {
    if (error?.context?.json) {
      const corpo = await error.context.json();
      if (corpo?.erro) return corpo.erro;
    }
  } catch {
    // corpo não veio em JSON (ex.: função fora do ar) — usa a mensagem genérica abaixo
  }
  return 'Não foi possível calcular a rota neste momento. Tente novamente.';
}

function mostrarErroRota(mensagem) {
  const card = document.getElementById('rota-card');
  card.innerHTML = `
    <div class="mensagem mensagem--erro">${escapar(mensagem)}</div>
    <button type="button" class="btn btn-secundario btn-bloco" id="rota-btn-tentar-novamente">Tentar de novo</button>`;
  document.getElementById('rota-btn-tentar-novamente')?.addEventListener('click', calcularRota);
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

function desenharCardRota(rota, observacoes) {
  const card = document.getElementById('rota-card');
  card.innerHTML = `
    <div class="rota-card__cabecalho">
      <span class="rota-card__icone">${icone('escudo', 24)}</span>
      <span class="rota-card__titulo">Rota segura</span>
      <span class="tag tag--verde">Recomendada</span>
    </div>
    <div class="rota-card__numeros">${formatarDuracao(rota.duracaoS)} (${formatarDistancia(rota.distanciaM)})</div>
    <div class="rota-card__observacoes">
      ${observacoes.map((o) => `
        <div class="rota-card__observacao">${icone(o.icone, 14)}<span>${escapar(o.texto)}</span></div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-primario btn-bloco" id="rota-btn-iniciar">
      ${icone('mira', 18)} Iniciar
    </button>
    <div class="rota-card__aviso">
      As recomendações são baseadas nos dados disponíveis na plataforma e não garantem segurança.
    </div>`;
  document.getElementById('rota-btn-iniciar')?.addEventListener('click', iniciarNavegacaoClique);
}

/** Marcadores de relatos/pontos de apoio/delegacias perto da rota, no mesmo
    estilo do mapa da Tela 1 (map.js), para você ver o que existe no caminho. */
function desenharContextoDaRota({ relatos, pontos, delegacias }) {
  camadaContexto.clearLayers();

  relatos.forEach((r) => {
    const nomeIcone = ICONE_POR_TIPO_RELATO[r.type] || 'escudo';
    L.marker([r.lat, r.lng], { icon: divIconContexto(nomeIcone, corDoRelato(r)), alt: ROTULOS_RELATO[r.type] || 'Relato' })
      .bindPopup(`
        <div class="popup__tipo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
        <div class="popup__meta">${escapar(r.address || 'Endereço não informado')}</div>
      `)
      .addTo(camadaContexto);
  });

  pontos.forEach((p) => {
    const criador = ICONE_CONTEXTO[p.type] || ICONE_CONTEXTO.ponto_apoio;
    L.marker([p.lat, p.lng], { icon: criador(), alt: p.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(p.name)}</div>
        <div class="popup__meta">${escapar(p.address || '')}</div>
      `)
      .addTo(camadaContexto);
  });

  delegacias.forEach((d) => {
    L.marker([d.lat, d.lng], { icon: ICONE_CONTEXTO.delegacia(), alt: d.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(d.name)}</div>
        <div class="popup__meta">${d.is_women_only ? 'Delegacia da Mulher' : 'Delegacia'}</div>
      `)
      .addTo(camadaContexto);
  });
}

// ------------------------------------------------ Pontuação de risco --- //
// Cada relato perto de UMA alternativa de rota soma pontos conforme a
// gravidade que a própria autora marcou ao publicar ("baixo"/"médio"/
// "alto") — não pelo tipo do relato, já que a gravidade é quem realmente
// diz o quão preocupante aquilo é. Cada ponto de apoio/delegacia perto
// SUBTRAI pontos (ajuda, mas não anula sozinho um relato de alto risco: um
// só ponto de apoio tira só metade do peso de um "alto"). No fim, a rota
// escolhida é a de MENOR pontuação — se todas tiverem relato perto, vence a
// que tiver menos/mais leve, exatamente como pedido.
const PESO_RISCO_POR_GRAVIDADE = { baixo: 1, medio: 2, alto: 4 };
const PONTOS_POR_APOIO_PERTO = -2;
const RAIO_PONTUACAO_M = 70; // mesmo raio já usado pra "isso está no caminho"

/** Busca relatos, pontos de apoio e delegacias numa área — a MESMA busca serve
    pra pontuar várias alternativas de rota de uma vez (evita repetir a
    consulta ao banco pra cada uma): a área cobre todas juntas, e depois cada
    alternativa filtra só o que está perto DELA (ver pontuarCandidata). */
async function buscarRelatosPontosEDelegaciasNaArea(geometrias) {
  const pontos = geometrias.flat();
  const lats = pontos.map((p) => p[0]);
  const lngs = pontos.map((p) => p[1]);
  const margem = 0.003; // ~300 m de folga ao redor da área
  const sul = Math.min(...lats) - margem, norte = Math.max(...lats) + margem;
  const oeste = Math.min(...lngs) - margem, leste = Math.max(...lngs) + margem;

  const [relatos, apoio, delegacias] = await Promise.all([
    supabase.from('reports')
      .select('type,attention_level,address,lat,lng')
      .gte('lat', sul).lte('lat', norte).gte('lng', oeste).lte('lng', leste)
      .eq('status', 'approved')
      .limit(200),
    supabase.from('support_points')
      .select('type,name,address,lat,lng')
      .gte('lat', sul).lte('lat', norte).gte('lng', oeste).lte('lng', leste)
      .eq('status', 'approved')
      .limit(200),
    supabase.from('police_stations')
      .select('name,address,is_women_only,lat,lng')
      .gte('lat', sul).lte('lat', norte).gte('lng', oeste).lte('lng', leste)
      .eq('status', 'approved')
      .limit(100)
  ]);

  return { relatos: relatos.data || [], pontos: apoio.data || [], delegacias: delegacias.data || [] };
}

/** Filtra o que está perto DESSA alternativa específica e calcula a
    pontuação de risco dela (quanto menor, mais segura). */
function pontuarCandidata(geometria, bruto) {
  const pertoDaRota = (lat, lng, raioM) =>
    geometria.some(([rLat, rLng]) => distanciaMetros(lat, lng, rLat, rLng) <= raioM);

  const relatos = bruto.relatos.filter((r) => pertoDaRota(r.lat, r.lng, RAIO_PONTUACAO_M));
  const pontos = bruto.pontos.filter((p) => pertoDaRota(p.lat, p.lng, RAIO_PONTUACAO_M));
  const delegacias = bruto.delegacias.filter((d) => pertoDaRota(d.lat, d.lng, RAIO_PONTUACAO_M));

  let pontuacao = 0;
  relatos.forEach((r) => { pontuacao += PESO_RISCO_POR_GRAVIDADE[r.attention_level] ?? PESO_RISCO_POR_GRAVIDADE.medio; });
  pontuacao += (pontos.length + delegacias.length) * PONTOS_POR_APOIO_PERTO;

  return { relatos, pontos, delegacias, pontuacao };
}

/** Recebe as alternativas de rota que a Edge Function calculou (1 a 3) e
    escolhe a de menor pontuação de risco — em caso de empate, a mais curta.
    Se a busca no banco falhar, não trava o app: cai de volta pra primeira
    alternativa (a que o ORS considera principal), sem pontuação nenhuma. */
async function escolherRotaMaisSegura(rotas) {
  if (rotas.length === 1) {
    const bruto = await buscarRelatosPontosEDelegaciasNaArea([rotas[0].geometria]).catch(() => ({ relatos: [], pontos: [], delegacias: [] }));
    return { ...rotas[0], ...pontuarCandidata(rotas[0].geometria, bruto), eraAMaisRapida: true };
  }

  try {
    const bruto = await buscarRelatosPontosEDelegaciasNaArea(rotas.map((r) => r.geometria));
    const pontuadas = rotas.map((r) => ({ ...r, ...pontuarCandidata(r.geometria, bruto) }));

    const maisRapida = pontuadas.reduce((m, r) => (r.distanciaM < m.distanciaM ? r : m), pontuadas[0]);
    const escolhida = [...pontuadas].sort((a, b) => a.pontuacao - b.pontuacao || a.distanciaM - b.distanciaM)[0];

    return { ...escolhida, eraAMaisRapida: escolhida === maisRapida };
  } catch (erro) {
    console.error('Falha ao pontuar as alternativas de rota:', erro);
    return { ...rotas[0], relatos: [], pontos: [], delegacias: [], pontuacao: 0, eraAMaisRapida: true };
  }
}

/** Monta o texto de observações do card a partir do que foi encontrado perto
    da rota ESCOLHIDA — só dados reais do banco, nunca inventa iluminação/
    movimento que a plataforma não sabe. */
function montarObservacoes({ relatos, pontos, delegacias }) {
  const iluminacao = relatos.filter((r) => r.type === 'rua_pouco_iluminada');
  const outros = relatos.filter((r) => r.type !== 'rua_pouco_iluminada');
  const altoRisco = outros.filter((r) => r.attention_level === 'alto');
  // "baixo"/"médio" também pesam na pontuação que escolheu a rota (ver
  // pontuarCandidata) — por isso também entram aqui, mesmo sem o alerta mais
  // forte do alto risco. Sem isso, o card podia dizer "nenhum relato" perto
  // de uma rota que na verdade tinha um relato leve considerado na escolha.
  const demaisRiscos = outros.filter((r) => r.attention_level !== 'alto');

  const observacoes = [];
  const apoioNoCaminho = pontos.length + delegacias.length;
  if (apoioNoCaminho > 0) {
    observacoes.push({
      icone: 'predio',
      texto: `${apoioNoCaminho} ${apoioNoCaminho === 1 ? 'ponto de apoio/delegacia' : 'pontos de apoio/delegacias'} no caminho`
    });
  }
  if (iluminacao.length > 0) {
    observacoes.push({
      icone: 'lampada',
      texto: `${iluminacao.length} ${iluminacao.length === 1 ? 'relato' : 'relatos'} de rua pouco iluminada perto deste trajeto`
    });
  }
  if (altoRisco.length > 0) {
    observacoes.push({
      icone: 'alerta',
      texto: `${altoRisco.length} ${altoRisco.length === 1 ? 'relato' : 'relatos'} de alto risco perto deste trajeto — redobre a atenção`
    });
  }
  if (demaisRiscos.length > 0) {
    observacoes.push({
      icone: 'alerta',
      texto: `${demaisRiscos.length} ${demaisRiscos.length === 1 ? 'outro relato' : 'outros relatos'} de risco perto deste trajeto`
    });
  }
  if (!observacoes.length) {
    observacoes.push({ icone: 'escudo', texto: 'Nenhum relato registrado perto deste trajeto até agora' });
  }
  return observacoes;
}

async function salvarHistoricoRota(rota) {
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  if (!user) return;
  const { error } = await supabase.from('route_history').insert({
    user_id: user.id,
    origin_address: origem?.nome || null,
    origin_lat: origem?.lat ?? null,
    origin_lng: origem?.lng ?? null,
    destination_address: destino?.nome || null,
    destination_lat: destino?.lat ?? null,
    destination_lng: destino?.lng ?? null,
    distance_meters: rota.distanciaM,
    duration_seconds: rota.duracaoS
  });
  if (error) throw error;
}

/* ------------------------------------------------------ Iniciar navegação --- */
function iniciarNavegacaoClique() {
  if (!rotaAtual || !origem || !destino) return;

  // O acompanhamento em si é sempre real (GPS de verdade), não importa se a
  // partida foi digitada ou veio do GPS — ver navigation.js.
  document.getElementById('painel-planejamento').hidden = true;
  document.getElementById('rota-card').hidden = true; // agora é irmão do painel, não filho — precisa esconder também
  document.getElementById('rota-bottom-nav').hidden = true;
  document.getElementById('rota-titulo').textContent = 'Navegando';
  document.getElementById('rota-subtitulo').textContent = 'Toque em "Encerrar rota" quando terminar.';

  // Mapa em tela cheia + botões flutuantes (visual estilo Google Maps/Waze) —
  // ver rotas.css. O Leaflet não percebe sozinho que o contêiner do mapa
  // mudou de tamanho via CSS, por isso o invalidateSize() logo depois.
  document.getElementById('app-rotas').classList.add('app-rotas--navegando');
  document.getElementById('rota-mapa-wrapper').classList.add('rota-mapa-wrapper--navegando');
  document.getElementById('navegacao-colapsar').hidden = false;
  document.getElementById('navegacao-recentralizar-flutuante').hidden = false;
  mapa.invalidateSize();

  document.getElementById('navegacao-pontos-apoio').onclick = () => {
    const pontos = [];
    camadaContexto.eachLayer((l) => { if (l.getLatLng) pontos.push(l.getLatLng()); });
    if (!pontos.length) {
      toast('Nenhum ponto de apoio ou delegacia perto dessa rota.', 'info');
      return;
    }
    mapa.fitBounds(L.latLngBounds(pontos), { padding: [60, 60] });
  };

  iniciarNavegacao({
    mapa,
    origem,
    destino,
    rota: rotaAtual,
    aoSair: voltarAoPlanejamento
  });
  // Só dá pra medir a altura de verdade da folha/SOS DEPOIS que a navegação
  // os deixou visíveis (iniciarNavegacao tira o "hidden" da folha) — usadas
  // pelos botões flutuantes (zoom, recentrar) e pelo cálculo de câmera em
  // navigation.js pra saber quanto do mapa fica realmente visível.
  medirRodapeDeNavegacao();
}

function medirRodapeDeNavegacao() {
  // Definidas no PRÓPRIO #app-rotas (não em :root/html) de propósito: é
  // nele que o CSS já declara os valores-palpite via ".app-rotas--
  // navegando" — uma variável herdada de :root nunca venceria uma
  // declaração direta no próprio elemento, então o palpite ficaria preso
  // pra sempre se a gente definisse isto lá em cima.
  const raiz = document.getElementById('app-rotas')?.style;
  if (!raiz) return;
  const folha = document.getElementById('painel-navegacao');
  const sos = document.getElementById('rota-sos');
  if (folha) raiz.setProperty('--altura-folha-nav', `${folha.getBoundingClientRect().height}px`);
  if (sos) raiz.setProperty('--altura-sos-nav', `${sos.getBoundingClientRect().height}px`);
}

function voltarAoPlanejamento() {
  document.getElementById('painel-planejamento').hidden = false;
  document.getElementById('rota-card').hidden = false;
  document.getElementById('painel-navegacao').hidden = true;
  document.getElementById('rota-bottom-nav').hidden = false;
  document.getElementById('rota-titulo').textContent = 'Sua rota segura';
  document.getElementById('rota-subtitulo').textContent = 'Escolhemos o caminho mais seguro para você.';

  document.getElementById('app-rotas').classList.remove('app-rotas--navegando');
  document.getElementById('rota-mapa-wrapper').classList.remove('rota-mapa-wrapper--navegando');
  document.getElementById('navegacao-colapsar').hidden = true;
  document.getElementById('navegacao-recentralizar-flutuante').hidden = true;
  document.getElementById('navegacao-voz').hidden = true;
  mapa.invalidateSize();
}

/* ------------------------------------------------------------------ SOS --- */
async function acionarSos() {
  // BUG DE CONFIABILIDADE QUE ISTO CORRIGE: abrir a aba só depois de esperar
  // o Supabase e o GPS (tudo assíncrono) faz vários navegadores tratarem
  // window.open como pop-up não solicitado e BLOQUEAR silenciosamente — bem
  // no botão que mais precisa funcionar. Abrir a aba em branco JÁ no clique
  // (ainda síncrono) e só trocar a URL dela depois evita isso.
  // IMPORTANTE: sem a flag "noopener" aqui — com ela, window.open() devolve
  // null (testado ao vivo) e a gente perde a referência pra poder navegar a
  // aba depois. Em vez disso, zeramos w.opener manualmente: mesma proteção
  // de segurança (o wa.me não consegue acessar esta página de volta), sem
  // perder a referência.
  const janela = window.open('', '_blank');
  if (janela) janela.opener = null;
  try {
    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) { janela?.close(); return; }

    const { data: contatos, error } = await supabase
      .from('emergency_contacts')
      .select('name,phone,is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!contatos || !contatos.length) {
      janela?.close();
      abrirModal('modal-sos-sem-contato');
      return;
    }

    const { url } = await obterLinkDeEmergencia(contatos[0].phone);
    if (janela) janela.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (erro) {
    janela?.close();
    toast(erro.message || 'Não foi possível acionar o SOS agora.', 'erro', 6000);
  }
}
