/* ============================================================
   ROTA SEGURA — map.js
   Mapa interativo (Leaflet + OpenStreetMap, sem chave de API).
   Suporta: marcadores de relatos (tamanho por densidade de
   relatos no ponto), marcadores institucionais (delegacias em
   rosa, pontos de apoio em verde/azul) e escolha manual de ponto.
   ============================================================ */

const CORES_POR_NIVEL = {
  seguro: '#4C9A6E',
  atencao: '#D99C3F',
  alerta: '#C9505F'
};

const COR_DELEGACIA = '#D6428C';
const COR_APOIO = '#2E9E8F';

let mapa = null;
let marcadoresRelatos = [];
let marcadoresInstituicoes = [];
let marcadorTemporario = null;
let aoClicarNoMapaCallback = null;

export function inicializarMapa(containerId, { lat = -22.9068, lng = -43.1729, zoom = 12 } = {}) {
  if (mapa) return mapa;

  mapa = L.map(containerId).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(mapa);

  mapa.on('click', (e) => {
    if (aoClicarNoMapaCallback) aoClicarNoMapaCallback(e.latlng);
  });

  setTimeout(() => mapa.invalidateSize(), 200);
  return mapa;
}

export function invalidarTamanhoDoMapa() {
  if (mapa) mapa.invalidateSize();
}

export function obterInstanciaMapa() {
  return mapa;
}

/* ---------------------------------------------------------- */
/* Ícones                                                       */
/* ---------------------------------------------------------- */

/** Tamanho do pino cresce com o número de relatos ("heatmap visual"). */
function calcularTamanho(totalRelatos) {
  const base = 16;
  const incremento = Math.min(totalRelatos - 1, 6) * 4; // até +24px
  return base + incremento;
}

function criarIconeRelato(nivelSeguranca, totalRelatos) {
  const cor = CORES_POR_NIVEL[nivelSeguranca] || '#7C4DBF';
  const tamanho = calcularTamanho(totalRelatos);
  const mostrarContador = totalRelatos > 1;

  return L.divIcon({
    className: 'mapa-pin',
    html: `
      <span class="mapa-pin-dot" style="background:${cor};width:${tamanho}px;height:${tamanho}px;">
        ${mostrarContador ? `<span class="mapa-pin-contador">${totalRelatos}</span>` : ''}
      </span>`,
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
    popupAnchor: [0, -tamanho / 2]
  });
}

function criarIconeInstituicao(tipo) {
  const cor = tipo === 'delegacia' ? COR_DELEGACIA : COR_APOIO;
  // Escudo simples em SVG para delegacias; casa/coração para pontos de apoio.
  const caminho =
    tipo === 'delegacia'
      ? 'M12 2 3 6v6c0 5 3.8 9 9 10 5.2-1 9-5 9-10V6l-9-4Z'
      : 'M12 21s-7-4.35-9.5-8.5C.7 8.9 2.4 5.5 6 5.5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.6 0 5.3 3.4 3.5 7-2.5 4.15-9.5 8.5-9.5 8.5Z';

  return L.divIcon({
    className: 'mapa-pin-instituicao',
    html: `
      <span class="mapa-pin-instituicao-corpo" style="background:${cor};">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="${caminho}"/></svg>
      </span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

/* ---------------------------------------------------------- */
/* Marcadores de relatos                                        */
/* ---------------------------------------------------------- */

/**
 * pontos: array de { representante, totalRelatos, relatos, localKey }
 * onAbrirDetalhes(ponto): chamado ao clicar no pino.
 */
export function renderizarPontos(pontos, { onAbrirDetalhes } = {}) {
  marcadoresRelatos.forEach((m) => mapa.removeLayer(m));
  marcadoresRelatos = [];

  pontos.forEach((ponto) => {
    const { representante, totalRelatos } = ponto;
    const marker = L.marker([representante.latitude, representante.longitude], {
      icon: criarIconeRelato(representante.nivel_seguranca, totalRelatos)
    }).addTo(mapa);

    marker.on('click', () => onAbrirDetalhes && onAbrirDetalhes(ponto));
    marcadoresRelatos.push(marker);
  });
}

/* ---------------------------------------------------------- */
/* Marcadores institucionais (delegacias / pontos de apoio)     */
/* ---------------------------------------------------------- */

export function renderizarInstituicoes(instituicoes, { onSelecionar } = {}) {
  marcadoresInstituicoes.forEach((m) => mapa.removeLayer(m));
  marcadoresInstituicoes = [];

  instituicoes.forEach((inst) => {
    const marker = L.marker([inst.latitude, inst.longitude], { icon: criarIconeInstituicao(inst.tipo) })
      .addTo(mapa)
      .bindPopup(
        `<strong>${escaparHtml(inst.nome)}</strong><br>${escaparHtml(inst.endereco || '')}` +
        (inst.telefone ? `<br>📞 ${escaparHtml(inst.telefone)}` : '')
      );

    if (onSelecionar) marker.on('click', () => onSelecionar(inst));
    marcadoresInstituicoes.push(marker);
  });
}

export function centralizarEm(lat, lng, zoom = 15) {
  if (mapa) mapa.setView([lat, lng], zoom);
}

/** Ativa o "modo escolher no mapa": o próximo clique define lat/lng. */
export function ativarEscolhaDeLocal(callback) {
  aoClicarNoMapaCallback = (latlng) => {
    posicionarMarcadorTemporario(latlng);
    callback(latlng);
  };
}

export function posicionarMarcadorTemporario(latlng) {
  if (marcadorTemporario) mapa.removeLayer(marcadorTemporario);
  marcadorTemporario = L.marker(latlng, { icon: criarIconeRelato('atencao', 1) }).addTo(mapa);
}

export function desativarEscolhaDeLocal() {
  aoClicarNoMapaCallback = null;
}

export function limparMarcadorTemporario() {
  if (marcadorTemporario) {
    mapa.removeLayer(marcadorTemporario);
    marcadorTemporario = null;
  }
}

function escaparHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
