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
import { iniciarCacheDeLocalizacao, acionarSos } from './emergency.js';
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
  // Mesma cor nova de js/map.js (ICONES.comercio_24h) — antes era igual à
  // de delegacia, dava pra confundir os dois pinos só de olhar o mapa.
  comercio_24h: () => divIconContexto('predio', '#8D6E63'),
  ponto_onibus: () => divIconContexto('onibus', '#F4A261'),
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
let preferenciaRota = 'segura'; // 'segura' | 'equilibrada' | 'rapida' — ver PESO_SEGURANCA_POR_PREFERENCIA

/* ------------------------------------------------------------ Inicializar */
async function iniciar() {
  aplicarIcones();
  registrarServiceWorker('../sw.js');
  const usuario = await exigirLogin();
  if (!usuario) return;

  // Liga cedo, mesmo antes de qualquer botão de WhatsApp ser tocado — dá
  // tempo do cache "esquentar" antes que ela precise dele de verdade (ver
  // js/emergency.js, iniciarCacheDeLocalizacao).
  iniciarCacheDeLocalizacao();

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
  prepararSeletorDePreferencia(usuario.id);
  carregarPreferenciaDeRota(usuario.id);
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

/* ------------------------------------------------- Prioridade da rota --- */
/** Lê a preferência salva (ou 'segura' se a usuária nunca mexeu nisso — não
    existe linha em profiles antes da primeira edição de perfil, e esse valor
    default também já é a coluna default no banco, ver sql/schema.sql) e
    reflete no controle #rota-preferencia. */
async function carregarPreferenciaDeRota(userId) {
  const { data } = await supabase.from('profiles').select('preferencia_rota').eq('id', userId).maybeSingle();
  preferenciaRota = data?.preferencia_rota || 'segura';
  document.querySelectorAll('#rota-preferencia .rota-modo__opcao').forEach((botao) => {
    botao.setAttribute('aria-pressed', String(botao.dataset.preferencia === preferenciaRota));
  });
}

function prepararSeletorDePreferencia(userId) {
  const botoes = [...document.querySelectorAll('#rota-preferencia .rota-modo__opcao')];
  botoes.forEach((botao) => {
    botao.addEventListener('click', async () => {
      if (botao.dataset.preferencia === preferenciaRota) return;
      preferenciaRota = botao.dataset.preferencia;
      botoes.forEach((b) => b.setAttribute('aria-pressed', String(b === botao)));
      tentarCalcularRota();
      // upsert (não update): mesma razão de js/profile.js — a linha de
      // profiles pode ainda não existir pra essa usuária.
      await supabase.from('profiles').upsert({ id: userId, preferencia_rota: preferenciaRota });
    });
  });

  document.getElementById('abrir-como-calculamos')?.addEventListener('click', () => {
    preencherTextoComoCalculamos();
    abrirModal('modal-como-calculamos');
  });
}

/** Texto gerado a partir de CONFIGURACAO_PONTUACAO de verdade — nunca um
    número repetido à mão, que poderia desalinhar do que pontuarCandidata
    realmente usa se o peso mudar um dia. */
function preencherTextoComoCalculamos() {
  const el = document.getElementById('texto-como-calculamos');
  if (!el) return;
  const { PESO_RISCO_POR_GRAVIDADE: peso, PONTOS_POR_APOIO_PERTO: apoio, RAIO_PONTUACAO_M: raio, RAIO_APOIO_METROS: raioApoio } = CONFIGURACAO_PONTUACAO;
  el.innerHTML = `
    <p class="rota-modal__texto">
      Entre as alternativas de caminho, escolhemos a de MENOR pontuação de risco — nunca
      necessariamente a mais curta.
    </p>
    <p class="rota-modal__texto">
      Cada relato de segurança a até ${raio} m do caminho soma pontos conforme a gravidade que a
      própria autora marcou: <strong>+${peso.baixo}</strong> (baixo), <strong>+${peso.medio}</strong>
      (médio), <strong>+${peso.alto}</strong> (alto).
    </p>
    <p class="rota-modal__texto">
      Cada ponto de apoio ou delegacia a até ${raioApoio} m do caminho ajuda, tirando
      <strong>${Math.abs(apoio)}</strong> pontos.
    </p>
    <p class="rota-modal__texto">
      O controle "Prioridade da rota" ajusta o quanto o risco pesa contra a duração do caminho:
      em "Mais segura" (padrão) só o risco decide; em "Mais rápida", a duração passa a valer
      mais; "Equilibrada" fica no meio.
    </p>
  `;
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

  // Só afirma que "evitou" relatos quando havia de fato outra opção pior —
  // com uma rota só (ORS às vezes não acha alternativa nenhuma), não haveria
  // nada pra comparar, e a frase seria uma promessa vazia.
  const observacoes = [...avisosDeLocal];
  if (escolha.eraAMaisRapida === false) {
    observacoes.unshift({
      icone: 'escudo',
      texto: 'Entre os caminhos calculados, este foi o que passa perto de menos relatos — por isso não é o mais rápido.'
    });
  }

  desenharCardRota(rotaAtual, observacoes, escolha, montarListaDeRelatos(escolha));
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

/** `escolha` só existe quando a rota passou por escolherRotaMaisSegura (nunca
    no card de erro/carregando) — pontosPerto/delegaciasPerto/relatos vêm de
    lá. SEM nota/placar de propósito: um número 0-10 resumia tudo numa
    sensação só, e já saiu enganoso mais de uma vez (10/10 com relato de
    risco real no caminho). Em vez disso, cada relato aparece detalhado
    (`listaDeRelatos`) — o que é, a gravidade e o endereço — pra decisão ficar
    com quem vai andar o trajeto, não com um resumo abstrato. */
function desenharCardRota(rota, observacoes, escolha = {}, listaDeRelatos = []) {
  const card = document.getElementById('rota-card');
  const { pontosPerto = 0, delegaciasPerto = 0 } = escolha;

  const oferece = [
    { icone: 'escudo', texto: `${pontosPerto} ponto${pontosPerto === 1 ? '' : 's'} de apoio no trajeto` },
    { icone: 'predio', texto: `${delegaciasPerto} delegacia${delegaciasPerto === 1 ? '' : 's'} no trajeto` },
    { icone: 'alerta', texto: `${listaDeRelatos.length} relato${listaDeRelatos.length === 1 ? '' : 's'} de risco no trajeto` }
  ];

  const relatosHtml = listaDeRelatos.length ? `
    <div class="rota-card__relatos">
      <h3 class="rota-card__relatos-titulo">Relatos perto deste trajeto</h3>
      ${listaDeRelatos.map((r) => `
        <div class="rota-card__relato">
          <span class="rota-card__relato-icone">${icone(r.icone, 18)}</span>
          <div class="rota-card__relato-conteudo">
            <div class="rota-card__relato-topo">
              <strong>${escapar(r.rotulo)}</strong>
              <span class="tag ${r.tagGravidade}">${escapar(r.rotuloGravidade)}</span>
            </div>
            <div class="rota-card__relato-endereco">${escapar(r.endereco)}</div>
            ${r.inevitavel ? `
              <div class="rota-card__relato-inevitavel">
                ${icone('info', 13)} Nenhum caminho encontrado evita passar perto deste relato.
              </div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>` : `
    <div class="rota-card__relatos">
      <div class="rota-card__relato-vazio">${icone('escudo', 16)} Nenhum relato perto deste trajeto até agora.</div>
    </div>`;

  card.innerHTML = `
    <div class="rota-card__cabecalho">
      <span class="rota-card__icone">${icone('escudo', 24)}</span>
      <span class="rota-card__titulo">Rota segura</span>
      <span class="tag tag--verde">Recomendada</span>
    </div>
    <div class="rota-card__numeros">${formatarDuracao(rota.duracaoS)} (${formatarDistancia(rota.distanciaM)})</div>
    <div class="rota-card__oferece">
      ${oferece.map((o) => `<span class="rota-card__badge">${icone(o.icone, 14)}${escapar(o.texto)}</span>`).join('')}
    </div>
    <div class="rota-card__observacoes">
      ${observacoes.map((o) => `
        <div class="rota-card__observacao">${icone(o.icone, 14)}<span>${escapar(o.texto)}</span></div>
      `).join('')}
    </div>
    ${relatosHtml}
    <button type="button" class="btn btn-primario btn-bloco" id="rota-btn-iniciar">
      ${icone('mira', 18)} Iniciar
    </button>
    <div class="rota-card__aviso">
      As recomendações são baseadas nos dados disponíveis na plataforma e não garantem segurança.
    </div>`;
  document.getElementById('rota-btn-iniciar')?.addEventListener('click', iniciarNavegacaoClique);
}

/** Marcadores de relatos/pontos de apoio/delegacias perto da rota, no mesmo
    estilo do mapa da Tela 1 (map.js), para você ver o que existe no caminho —
    SEMPRE o mesmo raio (RAIO_APOIO_METROS) usado na contagem/selo e na lista
    detalhada (ver pontuarCadidata): nunca um pino aparecendo no mapa sem bater
    com o que o card diz, ou vice-versa. */
function desenharContextoDaRota({ relatos, pontos, delegacias }) {
  camadaContexto.clearLayers();

  relatos.forEach((r) => {
    const nomeIcone = ICONE_POR_TIPO_RELATO[r.type] || 'escudo';
    const marcador = L.marker([r.lat, r.lng], { icon: divIconContexto(nomeIcone, corDoRelato(r)), alt: ROTULOS_RELATO[r.type] || 'Relato' })
      .bindPopup(`
        <div class="popup__tipo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
        <div class="popup__meta">${escapar(r.address || 'Endereço não informado')}</div>
      `)
      .addTo(camadaContexto);
    // Marca o tipo em cada marcador — é o que permite ao botão "Pontos de
    // apoio" (ver navegacao-pontos-apoio) separar isso de relato, em vez de
    // varrer a camada inteira sem distinguir.
    marcador._categoriaContexto = 'relato';
  });

  pontos.forEach((p) => {
    const criador = ICONE_CONTEXTO[p.type] || ICONE_CONTEXTO.ponto_apoio;
    const marcador = L.marker([p.lat, p.lng], { icon: criador(), alt: p.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(p.name)}</div>
        <div class="popup__meta">${escapar(p.address || '')}</div>
      `)
      .addTo(camadaContexto);
    marcador._categoriaContexto = 'ponto';
  });

  delegacias.forEach((d) => {
    const marcador = L.marker([d.lat, d.lng], { icon: ICONE_CONTEXTO.delegacia(), alt: d.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(d.name)}</div>
        <div class="popup__meta">${d.is_women_only ? 'Delegacia da Mulher' : 'Delegacia'}</div>
        <div class="popup__fonte">Endereço do OpenStreetMap (comunidade) — confira antes de divulgar oficialmente.</div>
      `)
      .addTo(camadaContexto);
    marcador._categoriaContexto = 'ponto';
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
const RAIO_PONTUACAO_M = 70; // relato de risco — raio apertado de propósito
// Ponto de apoio/delegacia usa um raio mais largo que o do relato de risco:
// são sinal POSITIVO (reforça, nunca inventa risco), então o custo de ser
// generoso aqui é baixo — o custo de dizer "0 delegacias" com uma bem ali do
// lado (o que já aconteceu de verdade, reportado ao vivo) é muito pior.
const RAIO_APOIO_METROS = 150;

// Exportado só pra alimentar o texto do modal "Como calculamos a rota mais
// segura" (preencherTextoComoCalculamos, mais abaixo) — nunca duplicar estes
// números à mão em outro lugar (HTML, doc), pra nunca desalinhar do que a
// pontuação de verdade usa.
export const CONFIGURACAO_PONTUACAO = { PESO_RISCO_POR_GRAVIDADE, PONTOS_POR_APOIO_PERTO, RAIO_PONTUACAO_M, RAIO_APOIO_METROS };

// "Prioridade da rota" (controle em #rota-preferencia): o quanto o risco de
// segurança pesa contra a duração da rota na escolha final — 1 = só risco
// importa (comportamento de sempre, sem mudar nada pra quem nunca mexeu no
// controle), 0 = só duração importa (rota mais rápida, ignorando risco).
// "equilibrada" fica no meio, pesando os dois por igual.
// BUG QUE ISTO CORRIGE: "rapida" valia 0.2, não 0 — ou seja, escolher "Mais
// rápida" ainda deixava o risco pesar 20% na decisão, e podia trocar pra uma
// rota mais lenta mesmo assim. Quem aperta "Mais rápida" quer a mais rápida
// de verdade, não "principalmente rápida, mas depende".
const PESO_SEGURANCA_POR_PREFERENCIA = { segura: 1, equilibrada: 0.6, rapida: 0 };

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
      .select('id,type,attention_level,address,lat,lng')
      .gte('lat', sul).lte('lat', norte).gte('lng', oeste).lte('lng', leste)
      .eq('status', 'approved')
      // Sem isto, um relato SEU já expirado ainda pesava na pontuação de
      // risco de quem o criou (a policy de RLS libera ver as próprias
      // linhas sem checar prazo) — a rota "mais segura" calculada pra você
      // podia estar reagindo a um relato que nem devia mais contar.
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

/** Distância (m) de um ponto até o SEGMENTO de reta A-B mais próximo dele —
    projeta o ponto no segmento (clampado nas pontas) e mede a distância
    geodésica até essa projeção. Lat/lng tratados como plano local só pra
    achar ONDE no segmento cai a projeção (aproximação segura pra distâncias
    de rua, a escala de uma rota a pé/de carro dentro da cidade); a distância
    final em metros continua vindo de distanciaMetros (Haversine), não da
    aproximação planar.
    BUG QUE ISTO CORRIGE: antes a checagem de "está perto da rota" media a
    distância só até os VÉRTICES do traçado (geometria.some(...)), não até a
    LINHA entre eles — numa rua reta e longa (comum em avenida), o ORS
    devolve poucos vértices bem espaçados, e um ponto bem no meio do
    quarteirão (visivelmente EM CIMA da rua, no mapa) podia estar a centenas
    de metros do vértice mais próximo mesmo estando a poucos metros da rota
    de verdade — por isso delegacia/ponto de apoio visivelmente no caminho
    apareciam contados como "0". */
function distanciaPontoAoSegmento(lat, lng, [latA, lngA], [latB, lngB]) {
  const dx = lngB - lngA;
  const dy = latB - latA;
  if (dx === 0 && dy === 0) return distanciaMetros(lat, lng, latA, lngA);

  const t = ((lng - lngA) * dx + (lat - latA) * dy) / (dx * dx + dy * dy);
  const tClampado = Math.max(0, Math.min(1, t));
  const latProjetado = latA + tClampado * dy;
  const lngProjetado = lngA + tClampado * dx;
  return distanciaMetros(lat, lng, latProjetado, lngProjetado);
}

/** Filtra o que está perto DESSA alternativa específica e calcula a
    pontuação de risco dela (quanto menor, mais segura). */
function pontuarCandidata(geometria, bruto) {
  const pertoDaRota = (lat, lng, raioM) => {
    if (geometria.length < 2) {
      return geometria.some(([rLat, rLng]) => distanciaMetros(lat, lng, rLat, rLng) <= raioM);
    }
    for (let i = 0; i < geometria.length - 1; i++) {
      if (distanciaPontoAoSegmento(lat, lng, geometria[i], geometria[i + 1]) <= raioM) return true;
    }
    return false;
  };

  // DOIS raios de propósito diferentes, usados em TUDO que segue (relato,
  // ponto de apoio, delegacia): RAIO_PONTUACAO_M (70m, estreito) só pra
  // PONTUAR risco — decidir qual alternativa é mais segura é uma conta
  // interna, nunca aparece pra usuária, então pode (e deve) ser rigorosa.
  // RAIO_APOIO_METROS (150m, largo) pra TUDO que a usuária efetivamente VÊ —
  // pino no mapa, contagem no selo, item na lista detalhada — sempre o
  // MESMO raio nos três, nunca um critério pra desenhar e outro pra contar.
  //
  // BUG QUE ISTO CORRIGE: antes os PINOS do mapa vinham de `bruto.*` direto
  // — sem filtro de distância NENHUM, só a caixa (bounding box) larga ao
  // redor de TODAS as alternativas somadas (às vezes quilômetros, se elas
  // divergem). Por isso dava pra ver "3 delegacias" no mapa que na verdade
  // estavam perto de OUTRA alternativa (ou só dentro da margem da caixa),
  // não da rota realmente escolhida e desenhada — nenhum ajuste de raio na
  // CONTAGEM resolvia isso, porque o problema era o PINO nunca ter sido
  // filtrado, não o número. Agora pino, selo e lista usam a mesma busca.
  const relatosExibir = bruto.relatos.filter((r) => pertoDaRota(r.lat, r.lng, RAIO_APOIO_METROS));
  const pontosExibir = bruto.pontos.filter((p) => pertoDaRota(p.lat, p.lng, RAIO_APOIO_METROS));
  const delegaciasExibir = bruto.delegacias.filter((d) => pertoDaRota(d.lat, d.lng, RAIO_APOIO_METROS));

  const relatosPontuacao = bruto.relatos.filter((r) => pertoDaRota(r.lat, r.lng, RAIO_PONTUACAO_M));
  const pontosPontuacao = bruto.pontos.filter((p) => pertoDaRota(p.lat, p.lng, RAIO_PONTUACAO_M));
  const delegaciasPontuacao = bruto.delegacias.filter((d) => pertoDaRota(d.lat, d.lng, RAIO_PONTUACAO_M));

  let pontuacao = 0;
  relatosPontuacao.forEach((r) => { pontuacao += PESO_RISCO_POR_GRAVIDADE[r.attention_level] ?? PESO_RISCO_POR_GRAVIDADE.medio; });
  pontuacao += (pontosPontuacao.length + delegaciasPontuacao.length) * PONTOS_POR_APOIO_PERTO;

  return {
    relatos: relatosExibir, pontos: pontosExibir, delegacias: delegaciasExibir, pontuacao,
    pontosPerto: pontosExibir.length, delegaciasPerto: delegaciasExibir.length
  };
}

// Usado por ordenarPorPrioridade pra misturar risco com duração — um valor
// sozinho não diz nada ("risco 3" é bom ou ruim?), só comparado ao restante
// das alternativas desta mesma busca faz sentido ali (ESCOLHER a melhor
// entre as opções que existem agora, não importa o quão arriscadas todas
// sejam em termos absolutos).
const normalizar = (valor, min, max) => (max === min ? 0 : (valor - min) / (max - min));


/** Ordena as alternativas já pontuadas pela prioridade escolhida. Com
    "segura" (padrão, peso 1) o critério é EXATAMENTE o de sempre — pontuação
    de risco, empate decidido pela mais curta — sem nenhuma mudança de
    comportamento pra quem nunca mexeu no controle de prioridade. Só
    "equilibrada"/"rápida" (peso < 1) passam a misturar risco com duração,
    normalizando os dois dentro do próprio conjunto de alternativas (não dá
    pra comparar "pontos de risco" com "segundos" sem isso).
*/
function ordenarPorPrioridade(pontuadas, pesoSeguranca) {
  if (pesoSeguranca >= 1) {
    return [...pontuadas].sort((a, b) => a.pontuacao - b.pontuacao || a.distanciaM - b.distanciaM);
  }

  const pontuacaoMin = Math.min(...pontuadas.map((p) => p.pontuacao));
  const pontuacaoMax = Math.max(...pontuadas.map((p) => p.pontuacao));
  const duracaoMin = Math.min(...pontuadas.map((p) => p.duracaoS));
  const duracaoMax = Math.max(...pontuadas.map((p) => p.duracaoS));

  return [...pontuadas]
    .map((p) => ({
      ...p,
      scorePrioridade:
        pesoSeguranca * normalizar(p.pontuacao, pontuacaoMin, pontuacaoMax) +
        (1 - pesoSeguranca) * normalizar(p.duracaoS, duracaoMin, duracaoMax)
    }))
    .sort((a, b) => a.scorePrioridade - b.scorePrioridade);
}

/** Recebe as alternativas de rota que a Edge Function calculou (1 a 3) e
    escolhe a melhor conforme a prioridade escolhida em #rota-preferencia
    (padrão "segura": menor pontuação de risco, empate pela mais curta). Se a
    busca no banco falhar, não trava o app: cai de volta pra primeira
    alternativa (a que o ORS considera principal), sem pontuação nenhuma. */
async function escolherRotaMaisSegura(rotas) {
  if (rotas.length === 1) {
    const bruto = await buscarRelatosPontosEDelegaciasNaArea([rotas[0].geometria]).catch(() => ({ relatos: [], pontos: [], delegacias: [] }));
    const pontuada = pontuarCandidata(rotas[0].geometria, bruto);
    // Só existe esta alternativa — nenhuma outra pra comparar, então todo
    // relato dela é "inevitável" por definição (não existe caminho sem ele).
    return {
      ...rotas[0], ...pontuada, eraAMaisRapida: true,
      relatosInevitaveisIds: new Set(pontuada.relatos.map((r) => r.id))
    };
  }

  try {
    const bruto = await buscarRelatosPontosEDelegaciasNaArea(rotas.map((r) => r.geometria));
    const pontuadas = rotas.map((r) => ({ ...r, ...pontuarCandidata(r.geometria, bruto) }));

    const pesoSeguranca = PESO_SEGURANCA_POR_PREFERENCIA[preferenciaRota] ?? 1;
    // BUG QUE ISTO CORRIGE: comparava por distanciaM (menor distância), não
    // por duracaoS (menor tempo) — "mais rápida" é sobre TEMPO, e uma rota
    // mais curta em metros pode demorar mais (mais sinais, rua mais lenta)
    // do que uma mais longa só que mais direta. O card mostra duração em
    // destaque ("14 min (7,4 km)") — tinha caso de bater o olho e a rota
    // "mais rápida" escolhida mostrar um tempo MAIOR que outra alternativa.
    const maisRapida = pontuadas.reduce((m, r) => (r.duracaoS < m.duracaoS ? r : m), pontuadas[0]);
    const escolhida = ordenarPorPrioridade(pontuadas, pesoSeguranca)[0];

    // BUG QUE ISTO CORRIGE: comparava por "escolhida === maisRapida"
    // (igualdade de OBJETO) — mas ordenarPorPrioridade, sempre que a
    // prioridade não é "segura" (equilibrada/rápida), devolve uma lista
    // MAPEADA (`.map((p) => ({ ...p, scorePrioridade }))`), ou seja, objetos
    // NOVOS, nunca o mesmo objeto de `pontuadas`. Resultado: nesses dois
    // modos, "escolhida === maisRapida" dava FALSE sempre, mesmo quando a
    // rota escolhida era de fato a mais rápida — o card dizia "por isso não
    // é a mais rápida" mesmo quando era. Comparar pela duração (valor, não
    // referência) funciona nos três modos.
    const eraAMaisRapida = escolhida.duracaoS === maisRapida.duracaoS;

    // Um relato é "inevitável" quando aparece perto de TODAS as alternativas
    // encontradas, não só da escolhida — ou seja, nenhum caminho calculado
    // consegue evitá-lo (bem diferente de "foi o menos pior", que soava como
    // se houvesse opção). Mostrado por relato individual (ver
    // montarListaDeRelatos), pedido explícito: em vez de só contar relatos,
    // explicar quando passar perto de um deles não foi escolha, foi o único
    // caminho que existe.
    const relatosInevitaveisIds = new Set(
      escolhida.relatos
        .filter((r) => pontuadas.every((alt) => alt.relatos.some((r2) => r2.id === r.id)))
        .map((r) => r.id)
    );

    return { ...escolhida, eraAMaisRapida, relatosInevitaveisIds };
  } catch (erro) {
    console.error('Falha ao pontuar as alternativas de rota:', erro);
    return {
      ...rotas[0], relatos: [], pontos: [], delegacias: [], pontuacao: 0, eraAMaisRapida: true,
      pontosPerto: 0, delegaciasPerto: 0, relatosInevitaveisIds: new Set()
    };
  }
}

const ROTULO_GRAVIDADE = { baixo: 'Baixo risco', medio: 'Risco médio', alto: 'Alto risco' };
const TAG_GRAVIDADE = { baixo: 'tag--teal', medio: 'tag--amarelo', alto: 'tag--vermelho' };

/** Lista CONCRETA dos relatos perto da rota ESCOLHIDA — em vez de só contar
    quantos existem ("3 relatos de risco"), mostra O QUE é cada um (tipo,
    gravidade, endereço), pra ser informação útil de verdade pra quem vai
    passar por ali, não um número abstrato. Pedido explícito: trocar a nota/
    contagem por fatos concretos.
    `inevitavel` marca quando o relato aparece em TODAS as alternativas
    encontradas (ver relatosInevitaveisIds em escolherRotaMaisSegura) — nesse
    caso o card explica que não existe caminho que o evite, em vez de dar a
    entender que essa rota "escolheu" passar perto dele. */
function montarListaDeRelatos({ relatos, relatosInevitaveisIds = new Set() }) {
  const ordemGravidade = { alto: 0, medio: 1, baixo: 2 };
  return [...relatos]
    .sort((a, b) => (ordemGravidade[a.attention_level] ?? 1) - (ordemGravidade[b.attention_level] ?? 1))
    .map((r) => ({
      icone: ICONE_POR_TIPO_RELATO[r.type] || 'escudo',
      rotulo: ROTULOS_RELATO[r.type] || 'Relato',
      rotuloGravidade: ROTULO_GRAVIDADE[r.attention_level] || ROTULO_GRAVIDADE.medio,
      tagGravidade: TAG_GRAVIDADE[r.attention_level] || TAG_GRAVIDADE.medio,
      endereco: r.address || 'Endereço não informado',
      inevitavel: relatosInevitaveisIds.has(r.id)
    }));
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
    // Só ponto de apoio/delegacia, nunca relato — camadaContexto mistura os
    // três tipos no mesmo layer group, e antes o eachLayer varria tudo junto
    // sem distinguir (ver _categoriaContexto em desenharContextoDaRota).
    const marcadores = [];
    camadaContexto.eachLayer((l) => {
      if (l._categoriaContexto === 'ponto' && l.getLatLng) marcadores.push(l);
    });
    if (!marcadores.length) {
      toast('Nenhum ponto de apoio ou delegacia perto dessa rota.', 'info');
      return;
    }
    mapa.fitBounds(L.latLngBounds(marcadores.map((m) => m.getLatLng())), { padding: [60, 60] });
    // Abre o popup do mais próximo do centro atual do mapa (durante a
    // navegação o mapa fica centrado perto da posição de quem está andando)
    // — antes o botão só reenquadrava a câmera, sem nunca dizer o que era
    // o lugar.
    const centro = mapa.getCenter();
    const maisProximo = marcadores.reduce((perto, atual) =>
      centro.distanceTo(atual.getLatLng()) < centro.distanceTo(perto.getLatLng()) ? atual : perto
    );
    maisProximo.openPopup();
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

/* ------------------------------------------------------------------ SOS ---
   acionarSos agora mora em js/emergency.js (compartilhado com a Tela
   Início) — ver import no topo deste arquivo. */
