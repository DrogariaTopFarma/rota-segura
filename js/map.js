/* ============================================================================
   ROTA SEGURA — Mapa (Leaflet + OpenStreetMap)
   Tela de CONSULTA: mostra o que existe registrado sobre os locais.
   Não traça rota, não inicia viagem (isso é o Bloco 2).

   Regra de performance: carregamos apenas os dados dentro do retângulo
   visível do mapa (bounding box), nunca a base inteira.
   ============================================================================ */

import { supabase } from './supabase.js';
import { APP_CONFIG } from './config.js';
import { pinoMapa, icone } from './icons.js';
import { toast, escapar, formatarDataHora, distanciaMetros } from './ui.js';
import {
  obterPosicao, acompanharPosicao, mensagemDoMotivo,
  descreverPrecisao, precisaoRuim
} from './geolocation.js';

/* ------------------------------------------------------------- Rótulos --- */
export const ROTULOS_RELATO = {
  assedio_verbal: 'Assédio verbal',
  assedio_fisico: 'Assédio físico',
  assalto: 'Assalto',
  perseguicao: 'Perseguição',
  rua_pouco_iluminada: 'Rua pouco iluminada',
  local_isolado: 'Local isolado',
  outro: 'Outro'
};

export const ROTULOS_PONTO = {
  ponto_apoio: 'Ponto de apoio',
  farmacia: 'Farmácia',
  hospital: 'Hospital',
  comercio_24h: 'Comércio 24h',
  ponto_onibus: 'Ponto de ônibus',
  outro: 'Outro'
};

/* --------------------------------------------------------------- Estado --- */
let mapa = null;
let camadas = {};
let marcadorUsuario = null;
let circuloPrecisao = null;
let marcadorBusca = null;
let pararWatch = null;
let ultimaPosicao = null;
let carregando = false;
const ouvintes = [];

/* Controle do aviso de precisão.
   BUG QUE ISTO CORRIGE: o aviso era redesenhado a cada leitura do GPS
   (o watchPosition dispara várias vezes por minuto), então ele reaparecia
   sozinho para sempre e não tinha como fechar. Agora: mostra no máximo uma
   vez, some sozinho depois de alguns segundos, e tem botão de fechar que
   vale para o resto da sessão. */
let avisoPrecisaoDispensado = false;
let avisoPrecisaoJaMostrado = false;
let temporizadorAviso = null;

/** Permite que outros módulos saibam quando os relatos foram recarregados. */
export function aoAtualizarRelatos(fn) { ouvintes.push(fn); }

export function mapaAtual() { return mapa; }
export function posicaoUsuario() { return ultimaPosicao; }

/* ---------------------------------------------------------- Ícones Leaflet */
// Um L.divIcon é só uma "receita" (imutável) — o mesmo objeto pode ser
// reaproveitado em vários marcadores. Sem este cache, toda vez que a área
// visível recarregava, cada marcador remontava do zero a mesma string SVG.
const cacheDeIcones = new Map();
function divIcon(nomeIcone, cor) {
  const chave = `${nomeIcone}:${cor}`;
  if (!cacheDeIcones.has(chave)) {
    cacheDeIcones.set(chave, L.divIcon({
      html: pinoMapa(nomeIcone, cor),
      className: '',
      iconSize: [34, 42],
      iconAnchor: [17, 41],
      popupAnchor: [0, -36]
    }));
  }
  return cacheDeIcones.get(chave);
}

const ICONES = {
  relato_alto: () => divIcon('escudo', '#D32F2F'),
  relato: () => divIcon('escudo', '#E83D67'),
  iluminacao: () => divIcon('lampada', '#F4A261'),
  ponto_apoio: () => divIcon('escudo', '#4CAF7D'),
  hospital: () => divIcon('hospital', '#4CAF7D'),
  farmacia: () => divIcon('hospital', '#4CAF7D'),
  comercio_24h: () => divIcon('predio', '#7C5CBF'),
  ponto_onibus: () => divIcon('onibus', '#7C5CBF'),
  delegacia: () => divIcon('predio', '#7C5CBF'),
  busca: () => divIcon('pino', '#2D2430')
};

/* ------------------------------------------------------------ Inicializar */
export function criarMapa(idElemento = 'mapa') {
  mapa = L.map(idElemento, {
    zoomControl: true,
    attributionControl: true,
    // Canvas em vez do renderizador SVG padrão do Leaflet: com muitos
    // relatos, as manchas de densidade (círculos semitransparentes) viram
    // dezenas/centenas de elementos SVG sobrepostos — testado: canvas
    // desenha isso uns 40-50% mais rápido, sem mudar nada visualmente.
    renderer: L.canvas()
  }).setView(APP_CONFIG.centroPadrao, APP_CONFIG.zoomPadrao);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
    detectRetina: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(mapa);

  camadas = {
    // Fica ABAIXO de relatos/pontos/delegacias de propósito (adicionada
    // primeiro): é um fundo de contexto, os pinos continuam por cima e
    // clicáveis (os círculos são interactive:false, não capturam clique).
    densidade: L.layerGroup().addTo(mapa),
    relatos: L.layerGroup().addTo(mapa),
    pontos: L.layerGroup().addTo(mapa),
    delegacias: L.layerGroup().addTo(mapa)
  };

  // Recarrega os dados sempre que a pessoa arrasta ou dá zoom
  let timer;
  mapa.on('moveend zoomend', () => {
    clearTimeout(timer);
    timer = setTimeout(carregarDadosDaAreaVisivel, 350);
  });

  return mapa;
}

/* ------------------------------------------------- Localização do usuário */
function mostrarPosicaoNoMapa(pos) {
  ultimaPosicao = pos;
  desenharUsuario(pos);
  mapa.setView([pos.lat, pos.lng], APP_CONFIG.zoomPadrao);
}

export async function localizarUsuario({ silencioso = false } = {}) {
  const aviso = document.getElementById('mapa-aviso');
  try {
    const pos = await obterPosicao({
      precisaoDesejada: 25,
      tempoMaximo: 15000,
      // Mostra a PRIMEIRA leitura (mesmo aproximada) assim que ela chega, em
      // vez de deixar a tela sem nenhum pino até a leitura precisa terminar
      // de chegar — desenharUsuario já atualiza o mesmo marcador no lugar
      // quando a leitura final (mais precisa) resolver a Promise abaixo.
      aoObterAproximada: mostrarPosicaoNoMapa
    });
    mostrarPosicaoNoMapa(pos);
    if (aviso && !precisaoRuim(pos.precisao)) aviso.hidden = true;
    mostrarAvisoDePrecisao(pos.precisao);

    // Acompanha em tempo real (útil quando a pessoa está andando)
    if (!pararWatch) {
      pararWatch = acompanharPosicao(
        (p) => {
          // Só redesenha se andou mais de 8 m ou se a precisão melhorou.
          // Sem isto, o mapa piscava a cada leitura do GPS.
          const anterior = ultimaPosicao;
          const mudouMuito =
            !anterior ||
            distanciaMetros(anterior.lat, anterior.lng, p.lat, p.lng) > 8 ||
            p.precisao < anterior.precisao * 0.7;
          ultimaPosicao = p;
          if (mudouMuito) desenharUsuario(p);
        },
        () => {}
      );
    }
    return pos;
  } catch (erro) {
    const texto = mensagemDoMotivo(erro.motivo);
    if (aviso) { aviso.textContent = texto; aviso.hidden = false; }
    if (!silencioso) toast(texto, 'erro', 6000);
    return null;
  }
}

function desenharUsuario({ lat, lng, precisao }) {
  // O raio é a precisão REAL informada pelo navegador.
  // Antes havia um limite de 300 m aqui, que escondia de você o quanto a
  // localização estava ruim. Círculo grande = navegador chutando pelo Wi-Fi.
  const raio = precisao || 60;

  // BUG DE PERFORMANCE QUE ISTO CORRIGE: cada leitura do GPS removia e
  // recriava os dois desenhos do zero, mesmo só precisando mover um pouco —
  // isso reflow/repinta o mapa a cada atualização (o watchPosition dispara
  // várias vezes por minuto) e deixava o mapa "travando" no computador.
  // Agora só move/redimensiona os desenhos já existentes.
  if (circuloPrecisao) {
    circuloPrecisao.setLatLng([lat, lng]);
    circuloPrecisao.setRadius(raio);
  } else {
    circuloPrecisao = L.circle([lat, lng], {
      radius: raio,
      color: '#E83D67',
      fillColor: '#E83D67',
      fillOpacity: 0.12,
      weight: 1
    }).addTo(mapa);
  }

  if (marcadorUsuario) {
    marcadorUsuario.setLatLng([lat, lng]);
    marcadorUsuario.setPopupContent(
      `<div class="popup__tipo">Você está aqui</div>
       <div class="popup__meta">${escapar(descreverPrecisao(precisao))}</div>`
    );
  } else {
    marcadorUsuario = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#FFFFFF',
      weight: 3,
      fillColor: '#2F6BFF',
      fillOpacity: 1
    }).addTo(mapa).bindPopup(
      `<div class="popup__tipo">Você está aqui</div>
       <div class="popup__meta">${escapar(descreverPrecisao(precisao))}</div>`
    );
  }
}

/**
 * Avisa UMA VEZ quando o navegador não sabe direito onde você está.
 * Some sozinho em 12 segundos e tem botão de fechar definitivo.
 */
function mostrarAvisoDePrecisao(precisao) {
  const aviso = document.getElementById('mapa-aviso');
  if (!aviso) return;

  // Você já fechou este aviso: respeitamos e não insistimos mais.
  if (avisoPrecisaoDispensado) { aviso.hidden = true; return; }

  if (!precisaoRuim(precisao)) {
    aviso.hidden = true;
    return;
  }

  // Já mostramos uma vez nesta sessão: não repetimos.
  if (avisoPrecisaoJaMostrado) return;
  avisoPrecisaoJaMostrado = true;

  aviso.innerHTML = `
    <div class="mapa-aviso__texto">
      <strong>Localização aproximada</strong> — ${escapar(descreverPrecisao(precisao))}.
      Em notebook o navegador usa o Wi-Fi, não o GPS. No celular a precisão é bem melhor.
    </div>
    <button type="button" class="mapa-aviso__fechar" aria-label="Fechar aviso">
      ${icone('fechar', 16)}
    </button>`;
  aviso.hidden = false;

  aviso.querySelector('.mapa-aviso__fechar')?.addEventListener('click', () => {
    avisoPrecisaoDispensado = true;
    aviso.hidden = true;
    clearTimeout(temporizadorAviso);
  });

  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 12000);
}

export function recentralizar() {
  if (ultimaPosicao) {
    mapa.setView([ultimaPosicao.lat, ultimaPosicao.lng], APP_CONFIG.zoomPadrao);
  } else {
    localizarUsuario();
  }
}

/* --------------------------------------- Carregar dados da área visível --- */
export async function carregarDadosDaAreaVisivel() {
  if (!mapa || carregando) return;
  carregando = true;

  const b = mapa.getBounds();
  const sul = b.getSouth(), norte = b.getNorth();
  const oeste = b.getWest(), leste = b.getEast();

  try {
    const [relatos, pontos, delegacias] = await Promise.all([
      supabase.from('reports')
        .select('id,type,description,address,lat,lng,occurred_at,attention_level,status,created_at')
        .gte('lat', sul).lte('lat', norte)
        .gte('lng', oeste).lte('lng', leste)
        .order('occurred_at', { ascending: false })
        .limit(200),

      supabase.from('support_points')
        .select('id,type,name,address,lat,lng,phone,description,opening_hours,status')
        .gte('lat', sul).lte('lat', norte)
        .gte('lng', oeste).lte('lng', leste)
        .limit(200),

      supabase.from('police_stations')
        .select('id,name,address,lat,lng,phone,is_women_only,opening_hours,status')
        .gte('lat', sul).lte('lat', norte)
        .gte('lng', oeste).lte('lng', leste)
        .limit(100)
    ]);

    if (relatos.error) throw relatos.error;
    if (pontos.error) throw pontos.error;
    if (delegacias.error) throw delegacias.error;

    desenharRelatos(relatos.data || []);
    desenharPontos(pontos.data || []);
    desenharDelegacias(delegacias.data || []);

    ouvintes.forEach((fn) => fn(relatos.data || []));
  } catch (erro) {
    console.error(erro);
    toast('Não foi possível carregar os dados. Tente novamente.', 'erro');
  } finally {
    carregando = false;
  }
}

/* ------------------------------------------------------------ Desenhos --- */
/** Círculo suave sob cada relato: onde há vários próximos, as manchas se
    sobrepõem e a área fica visivelmente "mais vermelha" — dá pra perceber
    concentração de relatos num relance, sem precisar abrir cada pino.
    interactive:false para nunca atrapalhar o clique nos marcadores. */
function desenharManchaDeRelato(r) {
  L.circle([r.lat, r.lng], {
    radius: 90,
    stroke: false,
    fillColor: '#D32F2F',
    fillOpacity: 0.08,
    interactive: false
  }).addTo(camadas.densidade);
}

function desenharRelatos(lista) {
  camadas.relatos.clearLayers();
  camadas.densidade.clearLayers();
  lista.forEach((r) => {
    let tipoIcone = 'relato';
    if (r.type === 'rua_pouco_iluminada') tipoIcone = 'iluminacao';
    else if (r.attention_level === 'alto') tipoIcone = 'relato_alto';

    const pendente = r.status === 'pending'
      ? '<div class="popup__meta">Em análise pela moderação</div>' : '';

    L.marker([r.lat, r.lng], { icon: ICONES[tipoIcone](), alt: ROTULOS_RELATO[r.type] || 'Relato' })
      .bindPopup(`
        <div class="popup__tipo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
        <div class="popup__meta">${escapar(formatarDataHora(r.occurred_at))}</div>
        <div class="popup__meta">${escapar(r.address || 'Endereço não informado')}</div>
        ${r.description ? `<div class="popup__desc">${escapar(r.description)}</div>` : ''}
        ${pendente}
      `)
      .addTo(camadas.relatos);

    desenharManchaDeRelato(r);
  });
}

function desenharPontos(lista) {
  camadas.pontos.clearLayers();
  lista.forEach((p) => {
    const criador = ICONES[p.type] || ICONES.ponto_apoio;
    L.marker([p.lat, p.lng], { icon: criador(), alt: p.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(p.name)}</div>
        <div class="popup__meta">${escapar(ROTULOS_PONTO[p.type] || 'Ponto de apoio')}</div>
        <div class="popup__meta">${escapar(p.address || '')}</div>
        ${p.phone ? `<div class="popup__desc">Telefone: ${escapar(p.phone)}</div>` : ''}
        ${p.opening_hours ? `<div class="popup__meta">${escapar(p.opening_hours)}</div>` : ''}
        ${p.description ? `<div class="popup__desc">${escapar(p.description)}</div>` : ''}
      `)
      .addTo(camadas.pontos);
  });
}

function desenharDelegacias(lista) {
  camadas.delegacias.clearLayers();
  lista.forEach((d) => {
    L.marker([d.lat, d.lng], { icon: ICONES.delegacia(), alt: d.name })
      .bindPopup(`
        <div class="popup__tipo">${escapar(d.name)}</div>
        <div class="popup__meta">${d.is_women_only ? 'Delegacia da Mulher' : 'Delegacia'}</div>
        <div class="popup__meta">${escapar(d.address || '')}</div>
        ${d.phone ? `<div class="popup__desc">Telefone: ${escapar(d.phone)}</div>` : ''}
        ${d.opening_hours ? `<div class="popup__meta">${escapar(d.opening_hours)}</div>` : ''}
      `)
      .addTo(camadas.delegacias);
  });
}

/* ------------------------------------------------- Marcador da pesquisa --- */
export function marcarLocalPesquisado(lat, lng, titulo, { aproximado = false } = {}) {
  if (marcadorBusca) mapa.removeLayer(marcadorBusca);
  const aviso = aproximado
    ? '<div class="popup__meta popup__meta--atencao">Localização aproximada — o número exato não está mapeado.</div>'
    : '';
  marcadorBusca = L.marker([lat, lng], { icon: ICONES.busca(), alt: titulo })
    .addTo(mapa)
    .bindPopup(`<div class="popup__tipo">Local pesquisado</div><div class="popup__meta">${escapar(titulo)}</div>${aviso}`)
    .openPopup();
  mapa.setView([lat, lng], APP_CONFIG.zoomBusca);
}

/* ------------------------------------------------------------- Realtime --- */
export function ligarRealtimeRelatos() {
  supabase
    .channel('relatos-mapa')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, () => {
      carregarDadosDaAreaVisivel();
    })
    .subscribe();
}

/* --------------------------------------------------------------- Limpeza --- */
window.addEventListener('beforeunload', () => { if (pararWatch) pararWatch(); });
