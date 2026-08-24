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
import { renderizarLista } from './reports.js';

// Preview compacto, não a lista inteira — a lista completa já existe embaixo
// do mapa ("Relatos de segurança"). Evita travar a tela numa área com muitos
// relatos registrados.
const LIMITE_LISTA_PROXIMOS = 5;

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

/** "3 relatos e 2 notícias registrados..." — nunca omite um dos dois lados
    quando os dois existem, nem finge que só relato de usuária conta (a
    pedido: a busca por rua precisa contar as duas fontes). */
function textoResumoProximos(qtdRelatos, qtdNoticias) {
  const partes = [];
  if (qtdRelatos > 0) partes.push(`${qtdRelatos} relato${qtdRelatos === 1 ? '' : 's'}`);
  if (qtdNoticias > 0) partes.push(`${qtdNoticias} notícia${qtdNoticias === 1 ? '' : 's'} pública${qtdNoticias === 1 ? '' : 's'}`);

  if (!partes.length) return 'Nenhum relato ou notícia registrado próximo a este local.';

  const plural = (qtdRelatos + qtdNoticias) > 1;
  // Só notícia (nenhum relato): concordância no feminino ("registrada(s)",
  // por causa de "notícia"). Com relato, sozinho ou misturado com notícia:
  // masculino ("registrado(s)") — é a regra padrão do português pra
  // gênero misto, e "relato" já é masculino sozinho.
  const participio = qtdRelatos === 0
    ? (plural ? 'registradas' : 'registrada')
    : (plural ? 'registrados' : 'registrado');
  return `${partes.join(' e ')} ${participio} a até 500 m deste local.`;
}

async function contarRelatosProximos(local, container) {
  const raio = APP_CONFIG.raioBuscaMetros;
  // ~0.01 grau de latitude ≈ 1,1 km. Buscamos um quadrado e depois filtramos pelo raio.
  const delta = raio / 111000;
  const caixa = (query) => query
    .gte('lat', local.lat - delta).lte('lat', local.lat + delta)
    .gte('lng', local.lng - delta).lte('lng', local.lng + delta);

  const [relatosResp, noticiasResp] = await Promise.all([
    caixa(supabase.from('reports')
      .select('id,type,address,occurred_at,attention_level,status,lat,lng,image_url,agrees_count,disagrees_count')
      // Mais recente primeiro, pela data/hora real do relato — não pela
      // ordem de criação no banco. O filtro de raio abaixo usa .filter(),
      // que preserva a ordem que já veio assim do banco.
      .order('occurred_at', { ascending: false }))
      .limit(300),
    caixa(supabase.from('external_incidents')
      .select('id,category,title,description,address,city,lat,lng,source_url,confidence,occurred_at,published_at,matched_report_id')
      .in('status', ['active', 'confirmed'])
      .order('published_at', { ascending: false }))
      .limit(300)
  ]);

  const titulo = local.nome.split(',').slice(0, 3).join(',');
  const opcoes = { aproximado: local.aproximado };

  if (relatosResp.error) {
    mostrarResultado(container, titulo, 'Não foi possível carregar os dados. Tente novamente.', opcoes);
    return;
  }

  const relatosProximos = (relatosResp.data || []).filter(
    (r) => distanciaMetros(local.lat, local.lng, r.lat, r.lng) <= raio
  );
  // Notícia sem coordenada (fica sem pino no mapa também) não entra aqui —
  // não dá pra saber se está perto sem uma coordenada de verdade.
  const noticiasProximas = (noticiasResp.data || []).filter(
    (n) => typeof n.lat === 'number' && typeof n.lng === 'number'
      && distanciaMetros(local.lat, local.lng, n.lat, n.lng) <= raio
  );

  mostrarResultado(container, titulo, textoResumoProximos(relatosProximos.length, noticiasProximas.length), opcoes);
  mostrarListaDeProximos(container, relatosProximos, noticiasProximas);
}

/** Preview dos relatos/notícias mais recentes perto do local pesquisado (a
    lista completa já existe embaixo do mapa). mostrarResultado() já limpou
    o container antes desta chamada, então é seguro só anexar. */
function mostrarListaDeProximos(container, relatos, noticias) {
  if (!container || (!relatos.length && !noticias.length)) return;

  const lista = document.createElement('div');
  lista.className = 'resultado-busca__lista';
  renderizarLista(lista, relatos.slice(0, LIMITE_LISTA_PROXIMOS), noticias.slice(0, LIMITE_LISTA_PROXIMOS));
  container.appendChild(lista);

  const restantes = Math.max(0, relatos.length - LIMITE_LISTA_PROXIMOS)
    + Math.max(0, noticias.length - LIMITE_LISTA_PROXIMOS);
  if (restantes > 0) {
    const aviso = document.createElement('div');
    aviso.className = 'resultado-busca__mais';
    aviso.textContent = `+ ${restantes} não mostrado${restantes === 1 ? '' : 's'} aqui.`;
    container.appendChild(aviso);
  }
}
