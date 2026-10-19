/* ============================================================================
   ROTA SEGURA — Observatório: gráficos e tabela por REGIÃO (bairro)
   Lógica de dado/desenho — o bootstrap da PÁGINA (login, ícones, nav) mora
   em js/observatorio.js (pages/observatorio.html). Separado em dois arquivos
   só por nome ficar igual ao padrão do resto do projeto (1 JS por página).

   Gráficos a partir de dado que já existe no banco — nada inventado: relatos
   de usuária (reports) e notícias públicas coletadas automaticamente
   (external_incidents), sempre com o mesmo filtro de status/validade já
   usado no resto do app.

   Por que por região (e não por tipo/semana, como na primeira versão): é a
   pergunta de verdade que alguém se faz olhando o Observatório — "que
   bairro tem mais assalto", "onde falta iluminação" — não só "quantos
   relatos no total".

   Bairro de uma notícia externa já vem pronto do banco (neighborhood/city).
   Bairro de um relato de usuária NÃO existe como coluna (só lat/lng) —
   descobrimos com geocodificação reversa (bairroDeCoordenadas, Photon),
   agrupando por grade de ~110m antes de chamar a API, pra não repetir a
   mesma chamada pra relatos vizinhos.
   ============================================================================ */

import { supabase } from './supabase.js';
import { htmlEstadoVazio, escapar } from './ui.js';
import { bairroDeCoordenadas } from './geocoding.js';

const CORES_BARRA = ['#E83D67', '#7C5CBF', '#0097A7', '#F4A261', '#4CAF7D', '#D32F2F', '#D81B60', '#777777'];
const MAX_BAIRROS_NO_GRAFICO = 8;
const CONCORRENCIA_GEOCODIFICACAO = 5;

let carregado = false;

/** Roda `tarefa(item)` pra cada item da lista, no máximo `limite` de cada
    vez — evita disparar uma chamada à API do Photon por relato de uma vez
    só (poderia ser dezenas simultâneas). */
async function emLotes(itens, limite, tarefa) {
  const resultado = [];
  for (let i = 0; i < itens.length; i += limite) {
    const fatia = itens.slice(i, i + limite);
    resultado.push(...(await Promise.all(fatia.map(tarefa))));
  }
  return resultado;
}

export async function carregarObservatorio() {
  const container = document.getElementById('observatorio');
  if (!container || carregado) return;
  carregado = true;

  const agora = new Date().toISOString();
  const [relatosResp, noticiasResp] = await Promise.all([
    supabase.from('reports')
      .select('type,lat,lng')
      .eq('status', 'approved')
      .or(`expires_at.is.null,expires_at.gt.${agora}`)
      .limit(500),
    supabase.from('external_incidents')
      .select('category,neighborhood,city')
      .neq('category', 'geral')
      .in('status', ['active', 'confirmed'])
      .limit(500)
  ]);

  if (relatosResp.error || noticiasResp.error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar o Observatório. Tente novamente.</div>`;
    carregado = false;
    return;
  }

  const relatos = relatosResp.data || [];
  const noticias = noticiasResp.data || [];

  if (!relatos.length && !noticias.length) {
    container.innerHTML = htmlEstadoVazio('Ainda não há relatos ou notícias suficientes para montar o Observatório.');
    return;
  }

  container.innerHTML = `
    <div class="observatorio__cartao">
      <h3>Bairros com mais assalto</h3>
      <canvas id="observatorio-grafico-assalto"></canvas>
    </div>
    <div class="observatorio__cartao">
      <h3>Bairros com mais relato de rua pouco iluminada</h3>
      <canvas id="observatorio-grafico-infraestrutura"></canvas>
    </div>
    <div class="observatorio__cartao">
      <h3>Ocorrências por bairro (todas)</h3>
      <canvas id="observatorio-grafico-geral"></canvas>
    </div>
    <div class="observatorio__cartao">
      <h3>Tabela: relato interno x notícia pública, por bairro</h3>
      <div id="observatorio-tabela-bairros"></div>
    </div>
    <p class="observatorio__carregando" id="observatorio-carregando">Identificando o bairro de cada relato, pode levar alguns segundos...</p>
    <button type="button" class="btn btn-secundario btn-bloco" id="observatorio-baixar-pdf" hidden>Baixar em PDF</button>
  `;
  document.getElementById('observatorio-baixar-pdf')?.addEventListener('click', () => window.print());

  // Geocodifica só pontos ÚNICOS (grade de ~110m) — muitos relatos caem na
  // mesma célula, isso evita repetir a mesma chamada ao Photon.
  const celulaDe = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const celulasUnicas = [...new Map(
    relatos.filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => [celulaDe(r.lat, r.lng), r])
  ).values()];

  const bairroPorCelula = new Map();
  await emLotes(celulasUnicas, CONCORRENCIA_GEOCODIFICACAO, async (r) => {
    const bairro = await bairroDeCoordenadas(r.lat, r.lng);
    bairroPorCelula.set(celulaDe(r.lat, r.lng), bairro);
  });

  const relatosComBairro = relatos
    .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
    .map((r) => ({ ...r, bairro: bairroPorCelula.get(celulaDe(r.lat, r.lng)) }))
    .filter((r) => r.bairro);

  const noticiasComBairro = noticias
    .map((n) => ({ ...n, bairro: n.neighborhood || n.city }))
    .filter((n) => n.bairro);

  desenharGraficoPorBairro(
    'observatorio-grafico-assalto',
    [...relatosComBairro.filter((r) => r.type === 'assalto'), ...noticiasComBairro.filter((n) => n.category === 'assalto')],
    'Sem relato de assalto com bairro identificado ainda.'
  );
  desenharGraficoPorBairro(
    'observatorio-grafico-infraestrutura',
    [...relatosComBairro.filter((r) => r.type === 'rua_pouco_iluminada'), ...noticiasComBairro.filter((n) => n.category === 'rua_pouco_iluminada')],
    'Sem relato de rua pouco iluminada com bairro identificado ainda.'
  );
  desenharGraficoPorBairro(
    'observatorio-grafico-geral',
    [...relatosComBairro, ...noticiasComBairro],
    'Sem relato ou notícia com bairro identificado ainda.'
  );
  desenharTabelaPorBairro(relatosComBairro, noticiasComBairro);

  document.getElementById('observatorio-carregando')?.remove();
  const botaoPdf = document.getElementById('observatorio-baixar-pdf');
  if (botaoPdf) botaoPdf.hidden = false;
}

function desenharGraficoPorBairro(idCanvas, itens, textoVazio) {
  const canvas = document.getElementById(idCanvas);
  if (!canvas || typeof Chart === 'undefined') return;

  const contagem = new Map();
  itens.forEach((item) => contagem.set(item.bairro, (contagem.get(item.bairro) || 0) + 1));
  const entradas = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_BAIRROS_NO_GRAFICO);

  if (!entradas.length) {
    canvas.replaceWith(Object.assign(document.createElement('p'), {
      className: 'observatorio__vazio',
      textContent: textoVazio
    }));
    return;
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: entradas.map(([bairro]) => bairro),
      datasets: [{
        data: entradas.map(([, qtd]) => qtd),
        backgroundColor: entradas.map((_, i) => CORES_BARRA[i % CORES_BARRA.length])
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

/** Tabela com o mesmo critério pedido ("qual bairro tem maior índice,
    somando relato de usuária com notícia pública") — complementa os
    gráficos com os números exatos, inclusive a composição interno/externo
    que o gráfico sozinho não mostra. */
function desenharTabelaPorBairro(relatosComBairro, noticiasComBairro) {
  const container = document.getElementById('observatorio-tabela-bairros');
  if (!container) return;

  const porBairro = new Map();
  const soma = (bairro, campo) => {
    const atual = porBairro.get(bairro) || { internos: 0, externos: 0 };
    atual[campo]++;
    porBairro.set(bairro, atual);
  };
  relatosComBairro.forEach((r) => soma(r.bairro, 'internos'));
  noticiasComBairro.forEach((n) => soma(n.bairro, 'externos'));

  const linhas = [...porBairro.entries()]
    .map(([bairro, { internos, externos }]) => ({ bairro, internos, externos, total: internos + externos }))
    .sort((a, b) => b.total - a.total);

  if (!linhas.length) {
    container.innerHTML = htmlEstadoVazio('Sem bairro identificado ainda.');
    return;
  }

  container.innerHTML = `
    <table class="observatorio__tabela">
      <thead>
        <tr><th>Bairro</th><th>Total</th><th>Relatos</th><th>Notícias</th></tr>
      </thead>
      <tbody>
        ${linhas.map((l) => `
          <tr>
            <td>${escapar(l.bairro)}</td>
            <td><strong>${l.total}</strong></td>
            <td>${l.internos}</td>
            <td>${l.externos}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}
