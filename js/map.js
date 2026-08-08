/* ============================================================
   ROTA SEGURA — map.js
   Mapa interativo (Leaflet + OpenStreetMap, sem chave de API).
   ============================================================ */

const CORES_POR_NIVEL = {
  seguro: '#4C9A6E',
  atencao: '#D99C3F',
  alerta: '#C9505F'
};

let mapa = null;
let marcadores = [];
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

  // Corrige um bug comum do Leaflet quando o container começa oculto (display:none)
  setTimeout(() => mapa.invalidateSize(), 200);

  return mapa;
}

export function invalidarTamanhoDoMapa() {
  if (mapa) mapa.invalidateSize();
}

function criarIcone(nivelSeguranca) {
  const cor = CORES_POR_NIVEL[nivelSeguranca] || '#7C4DBF';
  return L.divIcon({
    className: 'mapa-pin',
    html: `<span style="background:${cor}" class="mapa-pin-dot"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

export function renderizarMarcadores(locais, { onSelecionar } = {}) {
  marcadores.forEach((m) => mapa.removeLayer(m));
  marcadores = [];

  locais.forEach((local) => {
    const marker = L.marker([local.latitude, local.longitude], { icon: criarIcone(local.nivel_seguranca) })
      .addTo(mapa)
      .bindPopup(
        `<strong>${escaparHtml(local.nome)}</strong><br>${escaparHtml(local.bairro)}<br>` +
        `<span style="color:${CORES_POR_NIVEL[local.nivel_seguranca]}">●</span> ${rotuloNivel(local.nivel_seguranca)}`
      );

    if (onSelecionar) marker.on('click', () => onSelecionar(local));
    marcadores.push(marker);
  });
}

export function centralizarEm(lat, lng, zoom = 15) {
  if (mapa) mapa.setView([lat, lng], zoom);
}

/** Ativa o "modo escolher no mapa": o próximo clique define lat/lng do formulário de cadastro. */
export function ativarEscolhaDeLocal(callback) {
  aoClicarNoMapaCallback = (latlng) => {
    if (marcadorTemporario) mapa.removeLayer(marcadorTemporario);
    marcadorTemporario = L.marker(latlng, { icon: criarIcone('atencao') }).addTo(mapa);
    callback(latlng);
  };
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

function rotuloNivel(nivel) {
  return { seguro: 'Seguro', atencao: 'Pouco iluminado', alerta: 'Isolado / Alerta' }[nivel] || nivel;
}

function escaparHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
