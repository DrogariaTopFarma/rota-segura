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
import { APP_CONFIG } from './config.js';
import { obterLinkDeEmergencia } from './emergency.js';
import { iniciarNavegacao } from './navigation.js';
import { marcarItemAtivo } from './nav.js';
import { ROTULOS_RELATO } from './map.js';

// Mesmas cores/ícones do mapa da Tela 1 (map.js), para os marcadores ao
// longo da rota serem reconhecíveis nas duas telas.
const ICONE_CONTEXTO = {
  relato_alto: () => divIconContexto('escudo', '#D32F2F'),
  relato: () => divIconContexto('escudo', '#E83D67'),
  iluminacao: () => divIconContexto('lampada', '#F4A261'),
  ponto_apoio: () => divIconContexto('escudo', '#4CAF7D'),
  hospital: () => divIconContexto('hospital', '#4CAF7D'),
  farmacia: () => divIconContexto('hospital', '#4CAF7D'),
  comercio_24h: () => divIconContexto('predio', '#7C5CBF'),
  ponto_onibus: () => divIconContexto('onibus', '#7C5CBF'),
  delegacia: () => divIconContexto('predio', '#7C5CBF')
};
function divIconContexto(nomeIcone, cor) {
  return L.divIcon({
    html: pinoMapa(nomeIcone, cor),
    className: '',
    iconSize: [34, 42],
    iconAnchor: [17, 41],
    popupAnchor: [0, -36]
  });
}

let mapa = null;
let camadaContexto = null; // relatos/pontos de apoio/delegacias perto da rota calculada
let marcadorOrigem = null;
let marcadorDestino = null;
let linhaRota = null;

let origem = null;    // { lat, lng, nome, fonte: 'gps' | 'manual' }
let destino = null;   // { lat, lng, nome }
let rotaAtual = null; // { distanciaM, duracaoS, geometria }
let tokenRota = 0;    // evita que uma resposta atrasada sobrescreva uma mais nova
let tokenOrigem = 0;  // evita que uma leitura de GPS atrasada sobrescreva uma origem escolhida à mão
let perfil = 'foot-walking'; // 'foot-walking' | 'driving-car'

/* ------------------------------------------------------------ Inicializar */
async function iniciar() {
  aplicarIcones();
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
  mapa = L.map('rota-mapa', { zoomControl: true, attributionControl: true })
    .setView(APP_CONFIG.centroPadrao, APP_CONFIG.zoomPadrao);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
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
        iconSize: [34, 42],
        iconAnchor: [17, 41]
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
      iconSize: [34, 42],
      iconAnchor: [17, 41]
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
      origem = { lat: r.lat, lng: r.lng, nome: r.curto, fonte: 'manual' };
      document.getElementById('rota-origem-label').textContent = 'Endereço de partida';
      desenharOrigem();
      tentarCalcularRota();
    }
  });

  prepararCampoBusca({
    input: document.getElementById('rota-destino'),
    sugestoes: document.getElementById('rota-sugestoes'),
    aoEscolher: (r) => {
      destino = { lat: r.lat, lng: r.lng, nome: r.curto };
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
  destino = origem ? { lat: origem.lat, lng: origem.lng, nome: origem.nome } : null;
  origem = antigoDestino
    ? { lat: antigoDestino.lat, lng: antigoDestino.lng, nome: antigoDestino.nome, fonte: 'manual' }
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

  rotaAtual = data;
  linhaRota = L.polyline(data.geometria, { color: '#E83D67', weight: 5, opacity: 0.9 }).addTo(mapa);
  mapa.fitBounds(linhaRota.getBounds(), { padding: [40, 40] });

  const contexto = await buscarContextoDaRota(data.geometria);
  if (meuToken !== tokenRota) return;

  desenharContextoDaRota(contexto);
  desenharCardRota(data, contexto.observacoes);
  salvarHistoricoRota(data).catch((erro) => console.error('Não foi possível salvar o histórico da rota:', erro));
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
    let tipo = 'relato';
    if (r.type === 'rua_pouco_iluminada') tipo = 'iluminacao';
    else if (r.attention_level === 'alto') tipo = 'relato_alto';
    L.marker([r.lat, r.lng], { icon: ICONE_CONTEXTO[tipo](), alt: ROTULOS_RELATO[r.type] || 'Relato' })
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

/** Busca relatos, pontos de apoio e delegacias perto da rota — só dados reais
    do banco, nunca inventa iluminação/movimento que a plataforma não sabe. */
async function buscarContextoDaRota(geometria) {
  const vazio = { relatos: [], pontos: [], delegacias: [], observacoes: [] };
  try {
    const lats = geometria.map((p) => p[0]);
    const lngs = geometria.map((p) => p[1]);
    const margem = 0.003; // ~300 m de folga ao redor da rota
    const sul = Math.min(...lats) - margem, norte = Math.max(...lats) + margem;
    const oeste = Math.min(...lngs) - margem, leste = Math.max(...lngs) + margem;

    const [relatos, pontos, delegacias] = await Promise.all([
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

    const pertoDaRota = (lat, lng, raioM) =>
      geometria.some(([rLat, rLng]) => distanciaMetros(lat, lng, rLat, rLng) <= raioM);

    const relatosNaRota = (relatos.data || []).filter((r) => pertoDaRota(r.lat, r.lng, 70));
    const pontosNaRota = (pontos.data || []).filter((p) => pertoDaRota(p.lat, p.lng, 70));
    const delegaciasNaRota = (delegacias.data || []).filter((d) => pertoDaRota(d.lat, d.lng, 70));

    const iluminacao = relatosNaRota.filter((r) => r.type === 'rua_pouco_iluminada');
    const altoRisco = relatosNaRota.filter((r) => r.type !== 'rua_pouco_iluminada' && r.attention_level === 'alto');

    const observacoes = [];
    const apoioNoCaminho = pontosNaRota.length + delegaciasNaRota.length;
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
    if (!observacoes.length) {
      observacoes.push({ icone: 'escudo', texto: 'Nenhum relato registrado perto deste trajeto até agora' });
    }

    return { relatos: relatosNaRota, pontos: pontosNaRota, delegacias: delegaciasNaRota, observacoes };
  } catch (erro) {
    console.error('Falha ao buscar o contexto da rota:', erro);
    return { ...vazio, observacoes: [{ icone: 'alerta', texto: 'Não foi possível conferir os relatos perto da rota agora' }] };
  }
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

  const previa = origem.fonte === 'manual';
  document.getElementById('painel-planejamento').hidden = true;
  document.getElementById('rota-card').hidden = true; // agora é irmão do painel, não filho — precisa esconder também
  document.getElementById('rota-bottom-nav').hidden = true;
  document.getElementById('rota-titulo').textContent = previa ? 'Prévia da rota' : 'Navegando';
  document.getElementById('rota-subtitulo').textContent = previa
    ? 'Partida digitada — sem acompanhamento de GPS em tempo real.'
    : 'Toque em "Encerrar rota" quando terminar.';

  iniciarNavegacao({
    mapa,
    origem,
    destino,
    rota: rotaAtual,
    aoSair: voltarAoPlanejamento
  });
}

function voltarAoPlanejamento() {
  document.getElementById('painel-planejamento').hidden = false;
  document.getElementById('rota-card').hidden = false;
  document.getElementById('painel-navegacao').hidden = true;
  document.getElementById('rota-bottom-nav').hidden = false;
  document.getElementById('rota-titulo').textContent = 'Sua rota segura';
  document.getElementById('rota-subtitulo').textContent = 'Escolhemos o caminho mais seguro para você.';
}

/* ------------------------------------------------------------------ SOS --- */
async function acionarSos() {
  try {
    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) return;

    const { data: contatos, error } = await supabase
      .from('emergency_contacts')
      .select('name,phone,is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!contatos || !contatos.length) {
      abrirModal('modal-sos-sem-contato');
      return;
    }

    const { url } = await obterLinkDeEmergencia(contatos[0].phone);
    window.open(url, '_blank', 'noopener');
  } catch (erro) {
    toast(erro.message || 'Não foi possível acionar o SOS agora.', 'erro', 6000);
  }
}
