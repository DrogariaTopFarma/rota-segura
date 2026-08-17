/* ============================================================================
   ROTA SEGURA — Barra de pesquisa da Tela 1
   Fluxo: digitar -> sugestões (debounce) -> escolher -> centraliza o mapa,
   marca o local e conta quantos relatos existem por perto.
   ============================================================================ */

import { supabase } from './supabase.js';
import { buscarEndereco } from './geocoding.js';
import { marcarLocalPesquisado, mapaAtual } from './map.js';
import { escapar, debounce, toast, distanciaMetros } from './ui.js';
import { APP_CONFIG } from './config.js';

/** Retângulo que você está vendo agora — usado para priorizar resultados perto. */
function areaVisivel() {
  const mapa = mapaAtual();
  if (!mapa) return null;
  const b = mapa.getBounds();
  return { oeste: b.getWest(), sul: b.getSouth(), leste: b.getEast(), norte: b.getNorth() };
}

export function prepararBusca() {
  const form = document.getElementById('form-busca');
  const input = document.getElementById('campo-busca');
  const sugestoes = document.getElementById('sugestoes-busca');
  const resultado = document.getElementById('resultado-busca');
  if (!form || !input) return;

  let resultadosAtuais = [];

  const sugerir = debounce(async (texto) => {
    if (texto.trim().length < 3) { sugestoes.hidden = true; return; }
    try {
      resultadosAtuais = await buscarEndereco(texto, { limite: 5, area: areaVisivel() });
      if (!resultadosAtuais.length) {
        sugestoes.innerHTML = '<button type="button" disabled>Nenhum endereço encontrado.</button>';
        sugestoes.hidden = false;
        return;
      }
      sugestoes.innerHTML = resultadosAtuais
        .map((r, i) => `
          <button type="button" data-i="${i}">
            <span>${escapar(r.curto)}</span>
            ${r.aproximado ? '<span class="sugestao-tag">sem número exato</span>' : ''}
          </button>`)
        .join('');
      sugestoes.hidden = false;
      sugestoes.querySelectorAll('button[data-i]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selecionar(resultadosAtuais[Number(btn.dataset.i)]);
        });
      });
    } catch {
      sugestoes.hidden = true;
      toast('Não foi possível buscar o endereço agora. Tente novamente.', 'erro');
    }
  }, APP_CONFIG.debounceMs);

  input.addEventListener('input', (e) => sugerir(e.target.value));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    sugestoes.hidden = true;
    const texto = input.value.trim();
    if (texto.length < 3) return;

    if (resultadosAtuais.length) return selecionar(resultadosAtuais[0]);

    try {
      const lista = await buscarEndereco(texto, { limite: 1, area: areaVisivel() });
      if (!lista.length) {
        mostrarResultado(resultado, texto, 'Endereço não encontrado. Tente escrever a rua e a cidade.');
        return;
      }
      selecionar(lista[0]);
    } catch {
      toast('Não foi possível buscar o endereço agora. Tente novamente.', 'erro');
    }
  });

  // Fechar sugestões ao clicar fora
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) sugestoes.hidden = true;
  });

  async function selecionar(local) {
    sugestoes.hidden = true;
    input.value = local.curto || local.nome;
    marcarLocalPesquisado(local.lat, local.lng, local.nome, { aproximado: local.aproximado });
    await contarRelatosProximos(local, resultado);
  }
}

function mostrarResultado(container, titulo, texto, { aproximado = false } = {}) {
  if (!container) return;
  const aviso = aproximado
    ? '<div class="resultado-busca__aviso">Localização aproximada — o número exato não está mapeado.</div>'
    : '';
  container.innerHTML = `<strong>${escapar(titulo)}</strong><span>${escapar(texto)}</span>${aviso}`;
  container.hidden = false;
}

async function contarRelatosProximos(local, container) {
  const raio = APP_CONFIG.raioBuscaMetros;
  // ~0.01 grau de latitude ≈ 1,1 km. Buscamos um quadrado e depois filtramos pelo raio.
  const delta = raio / 111000;

  const { data, error } = await supabase
    .from('reports')
    .select('id,lat,lng')
    .gte('lat', local.lat - delta).lte('lat', local.lat + delta)
    .gte('lng', local.lng - delta).lte('lng', local.lng + delta)
    .limit(300);

  const titulo = local.nome.split(',').slice(0, 3).join(',');
  const opcoes = { aproximado: local.aproximado };

  if (error) {
    mostrarResultado(container, titulo, 'Não foi possível carregar os dados. Tente novamente.', opcoes);
    return;
  }

  const proximos = (data || []).filter(
    (r) => distanciaMetros(local.lat, local.lng, r.lat, r.lng) <= raio
  );

  const texto = proximos.length === 0
    ? 'Nenhum relato registrado próximo a este local.'
    : proximos.length === 1
      ? '1 relato registrado a até 500 m deste local.'
      : `${proximos.length} relatos registrados a até 500 m deste local.`;

  mostrarResultado(container, titulo, texto, opcoes);
}
