/* ============================================================================
   ROTA SEGURA — Seletor de local

   FILOSOFIA DESTE ARQUIVO (mudou):
   "Usar minha localização" significa USAR A SUA LOCALIZAÇÃO. Ponto.
   Você não precisa marcar nada no mapa para cadastrar um relato.

   Fluxo real:
     1. Ao abrir o formulário, o app JÁ pede o GPS sozinho e preenche o local.
     2. Você lê o endereço no cartão e confirma olhando o mapinha.
     3. Só se estiver errado é que você abre "Não é aqui?" e corrige,
        pesquisando um endereço ou arrastando o pino.

   O mapa está aqui para CONFERIR, não para ser o jeito principal de marcar.

   Continua valendo: este seletor não tem nenhuma ligação com a busca da tela
   principal. Pesquisar um lugar no mapa grande não define onde o relato cai.
   ============================================================================ */

import { buscarEndereco, enderecoDeCoordenadas } from './geocoding.js';
import { obterPosicao, mensagemDoMotivo, descreverPrecisao, precisaoRuim } from './geolocation.js';
import { icone, pinoMapa } from './icons.js';
import { escapar, debounce, botaoCarregando } from './ui.js';
import { APP_CONFIG, CARTO_API_KEY } from './config.js';

const ICONE_PINO = () =>
  L.divIcon({
    html: pinoMapa('pino', '#E83D67'),
    className: '',
    iconSize: [28, 34],
    iconAnchor: [14, 33]
  });

/**
 * @param {object} ids
 * @param {string} ids.mapa      - div do mini-mapa de confirmação
 * @param {string} ids.busca     - input de pesquisa (dentro do "Não é aqui?")
 * @param {string} ids.sugestoes - div das sugestões
 * @param {string} ids.resumo    - cartão que mostra o local escolhido
 * @param {string} ids.botaoGps  - botão "Usar minha localização"
 * @param {string} ids.ajuste    - <details> com as opções de correção
 */
export function criarSeletorLocal(ids) {
  const elMapa = document.getElementById(ids.mapa);
  const elBusca = document.getElementById(ids.busca);
  const elSugestoes = document.getElementById(ids.sugestoes);
  const elResumo = document.getElementById(ids.resumo);
  const elGps = document.getElementById(ids.botaoGps);
  const elAjuste = ids.ajuste ? document.getElementById(ids.ajuste) : null;

  if (!elResumo) return { valor: () => null, limpar: () => {}, aoExibir: () => {} };

  let mapa = null;
  let marcador = null;
  let local = null;      // { lat, lng, nome, origem, precisao, aproximado }
  let buscandoGps = false;

  // BUG QUE ISTO CORRIGE: a localização por GPS é pedida sozinha assim que o
  // formulário abre e pode levar até 15s para responder. Se você pesquisar e
  // escolher uma rua ANTES do GPS terminar, a resposta do GPS chegava DEPOIS
  // e sobrescrevia sua escolha sem avisar — o relato/ponto acabava salvo no
  // lugar errado. Cada ação (pesquisa, arraste, clique no mapa, GPS) reserva
  // um número aqui; se uma ação mais nova já aconteceu quando uma mais velha
  // termina, a mais velha é descartada.
  let ultimaAcao = 0;

  /* ------------------------------------------------------- Mini-mapa ----- */
  function garantirMapa() {
    if (!elMapa) return null;

    if (mapa) {
      setTimeout(() => mapa.invalidateSize(), 60);
      return mapa;
    }

    mapa = L.map(elMapa, {
      zoomControl: false,
      attributionControl: false,
      // O mapa é de conferência: sem arrastar sem querer enquanto rola o modal
      dragging: true,
      scrollWheelZoom: false,
      tap: true
    }).setView(APP_CONFIG.centroPadrao, APP_CONFIG.zoomPadrao);

    // Sem attributionControl próprio (mini-mapa de conferência, 165px de
    // altura) — o crédito à OpenStreetMap/CARTO já aparece no mapa principal
    // da mesma página (mapa.html), que sempre está visível junto com este.
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`, {
      subdomains: 'abcd',
      maxZoom: 20,
      detectRetina: true
    }).addTo(mapa);
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);

    mapa.on('click', (e) => moverPino(e.latlng.lat, e.latlng.lng, 'manual'));

    setTimeout(() => mapa.invalidateSize(), 60);
    return mapa;
  }

  /* --------------------------------------------------- Definir o local --- */
  async function moverPino(lat, lng, origem, extras = {}) {
    const minhaAcao = ++ultimaAcao;
    const m = garantirMapa();

    if (m) {
      if (!marcador) {
        marcador = L.marker([lat, lng], {
          draggable: true,
          icon: ICONE_PINO(),
          keyboard: true,
          alt: 'Pino do local — arraste para ajustar'
        }).addTo(m);

        marcador.on('dragend', () => {
          const pos = marcador.getLatLng();
          moverPino(pos.lat, pos.lng, 'manual');
        });
      } else {
        marcador.setLatLng([lat, lng]);
      }
      m.setView([lat, lng], APP_CONFIG.zoomSeletor);
      setTimeout(() => m.invalidateSize(), 60);
    }

    local = {
      lat,
      lng,
      nome: extras.nome || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      origem,
      precisao: extras.precisao ?? null,
      aproximado: extras.aproximado ?? false
    };
    desenharResumo({ carregandoEndereco: !extras.nome });

    if (!extras.nome) {
      const endereco = await enderecoDeCoordenadas(lat, lng);
      if (minhaAcao === ultimaAcao) {
        local.nome = endereco;
        desenharResumo();
      }
    }
  }

  /* ------------------------------------------------------- Cartão -------- */
  function desenharResumo({ carregandoEndereco = false, procurandoGps = false, erro = null } = {}) {
    if (procurandoGps) {
      elResumo.className = 'local-resumo local-resumo--procurando';
      elResumo.innerHTML = `
        <div class="local-resumo__linha">
          <span class="spinner spinner--rosa"></span>
          <div><strong>Buscando sua localização...</strong>
          <div class="local-resumo__origem">Isso leva alguns segundos.</div></div>
        </div>`;
      elResumo.hidden = false;
      return;
    }

    if (erro) {
      elResumo.className = 'local-resumo local-resumo--atencao';
      elResumo.innerHTML = `
        <div class="local-resumo__linha">
          <span class="local-resumo__icone">${icone('alerta', 18)}</span>
          <div><strong>Não foi possível usar sua localização</strong>
          <div class="local-resumo__endereco">${escapar(erro)}</div></div>
        </div>`;
      elResumo.hidden = false;
      return;
    }

    if (!local) {
      elResumo.hidden = true;
      elResumo.innerHTML = '';
      return;
    }

    const titulo = {
      gps: 'Usando sua localização atual',
      busca: 'Usando o endereço pesquisado',
      manual: 'Usando o ponto que você ajustou'
    }[local.origem] || 'Local escolhido';

    const avisos = [];
    if (local.origem === 'gps' && precisaoRuim(local.precisao)) {
      avisos.push(`${descreverPrecisao(local.precisao)}. Se o endereço acima não for o certo, abra "Não é aqui?" abaixo.`);
    }
    if (local.aproximado) {
      avisos.push('O número exato não existe no mapa; o pino está na rua. Arraste-o se quiser precisão maior.');
    }

    elResumo.className = avisos.length ? 'local-resumo local-resumo--atencao' : 'local-resumo';
    elResumo.innerHTML = `
      <div class="local-resumo__linha">
        <span class="local-resumo__icone">${icone(local.origem === 'gps' ? 'mira' : 'pino', 18)}</span>
        <div>
          <strong>${escapar(titulo)}</strong>
          <div class="local-resumo__endereco">
            ${carregandoEndereco ? 'Identificando o endereço...' : escapar(local.nome)}
          </div>
          <div class="local-resumo__origem">${local.lat.toFixed(5)}, ${local.lng.toFixed(5)}</div>
          ${avisos.map((a) => `<div class="local-resumo__aviso">${escapar(a)}</div>`).join('')}
        </div>
      </div>`;
    elResumo.hidden = false;
  }

  /* ------------------------------------------------ Usar minha localização */
  async function localizar({ automatico = false } = {}) {
    if (buscandoGps) return;
    buscandoGps = true;
    const minhaAcao = ++ultimaAcao; // reserva a vez ANTES de esperar o GPS (que pode demorar)

    if (elGps) botaoCarregando(elGps, true, 'Buscando localização...');
    desenharResumo({ procurandoGps: true });

    try {
      const pos = await obterPosicao({ precisaoDesejada: 25, tempoMaximo: 15000 });
      // Enquanto esperava, você já pesquisou, arrastou o pino ou clicou no
      // mapa? Essa escolha mais nova vale mais do que o GPS atrasado.
      if (minhaAcao !== ultimaAcao) return;
      await moverPino(pos.lat, pos.lng, 'gps', { precisao: pos.precisao });
    } catch (err) {
      if (minhaAcao !== ultimaAcao) return;
      local = null;
      desenharResumo({ erro: mensagemDoMotivo(err.motivo) });
      // Sem GPS, a pessoa precisa do campo de busca à mão: abrimos sozinho.
      if (elAjuste) elAjuste.open = true;
      if (!automatico) elBusca?.focus();
    } finally {
      buscandoGps = false;
      if (elGps) botaoCarregando(elGps, false);
    }
  }

  elGps?.addEventListener('click', () => localizar());

  /* -------------------------------------------------------- Busca -------- */
  const buscar = debounce(async (texto) => {
    if (!elSugestoes) return;
    if (texto.trim().length < 3) { elSugestoes.hidden = true; return; }

    elSugestoes.innerHTML = '<button type="button" disabled>Procurando...</button>';
    elSugestoes.hidden = false;

    try {
      const area = mapa
        ? (() => {
            const b = mapa.getBounds();
            return { oeste: b.getWest(), sul: b.getSouth(), leste: b.getEast(), norte: b.getNorth() };
          })()
        : null;

      const resultados = await buscarEndereco(texto, { limite: 5, area });

      if (!resultados.length) {
        elSugestoes.innerHTML =
          '<button type="button" disabled>Nenhum endereço encontrado. Tente só a rua e a cidade.</button>';
        return;
      }

      elSugestoes.innerHTML = resultados
        .map((r, i) => `
          <button type="button" data-i="${i}">
            <span>${escapar(r.curto)}</span>
            ${r.aproximado ? '<span class="sugestao-tag">sem número exato</span>' : ''}
          </button>`)
        .join('');

      elSugestoes.querySelectorAll('button[data-i]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = resultados[Number(btn.dataset.i)];
          moverPino(r.lat, r.lng, 'busca', { nome: r.curto, aproximado: r.aproximado });
          elSugestoes.hidden = true;
          // Mantém o endereço escolhido escrito no campo (em vez de limpar) —
          // em formulários como o de ponto de apoio, esse texto é o que é salvo.
          elBusca.value = r.curto;
        });
      });
    } catch {
      elSugestoes.innerHTML =
        '<button type="button" disabled>Não foi possível buscar agora. Toque no mapa para marcar.</button>';
    }
  }, APP_CONFIG.debounceMs);

  elBusca?.addEventListener('input', (e) => buscar(e.target.value));
  elBusca?.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

  // Abrir o "Não é aqui?" precisa recalcular o mapa que estava escondido
  elAjuste?.addEventListener('toggle', () => {
    if (elAjuste.open) setTimeout(() => mapa?.invalidateSize(), 80);
  });

  /* ----------------------------------------------------------- API ------- */
  return {
    valor: () => local,

    localizar,

    limpar: () => {
      ultimaAcao++; // invalida qualquer busca de GPS/endereço ainda em andamento
      local = null;
      if (marcador && mapa) { mapa.removeLayer(marcador); marcador = null; }
      if (elBusca) elBusca.value = '';
      if (elSugestoes) elSugestoes.hidden = true;
      if (elAjuste) elAjuste.open = false;
      desenharResumo();
    },

    /**
     * Chamado quando o formulário aparece.
     * @param {object|null} posicaoConhecida - posição já obtida pelo mapa principal
     */
    aoExibir: (posicaoConhecida = null) => {
      garantirMapa();

      // Se o mapa principal já sabe onde você está, usamos NA HORA,
      // sem fazer você esperar o GPS de novo.
      if (posicaoConhecida && !local) {
        moverPino(posicaoConhecida.lat, posicaoConhecida.lng, 'gps', {
          precisao: posicaoConhecida.precisao
        });
        return;
      }

      // Senão, pedimos a localização sozinhos. Você não precisa clicar em nada.
      if (!local) localizar({ automatico: true });
    }
  };
}
