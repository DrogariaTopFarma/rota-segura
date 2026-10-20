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
   Bairro de um relato de usuária é resolvido UMA VEZ no cadastro (ver
   js/reports.js, bairroDeCoordenadas) e gravado na coluna reports.bairro —
   esta tela só LÊ o que já está salvo, nunca chama geocodificação reversa
   ao vivo. Antes era o contrário (recalculava toda vez que a tela abria,
   15s+ de espera, dependente do Photon estar disponível bem naquele
   instante) — mudou depois de reproduzir isso ao vivo e confirmar o
   problema. Relato sem bairro salvo (cadastrado antes desta coluna existir,
   ou o Photon falhou na hora) simplesmente não entra nos gráficos por
   região, sem travar a tela nem mostrar erro.
   ============================================================================ */

import { supabase } from './supabase.js';
import { htmlEstadoVazio, escapar } from './ui.js';

const CORES_BARRA = ['#E83D67', '#7C5CBF', '#0097A7', '#F4A261', '#4CAF7D', '#D32F2F', '#D81B60', '#777777'];
const MAX_BAIRROS_NO_GRAFICO = 8;

let carregado = false;

export async function carregarObservatorio() {
  const container = document.getElementById('observatorio');
  if (!container || carregado) return;
  carregado = true;

  const agora = new Date().toISOString();
  const [relatosResp, noticiasResp] = await Promise.all([
    supabase.from('reports')
      .select('type,bairro')
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

  const relatosComBairro = (relatosResp.data || []).filter((r) => r.bairro);
  const noticias = noticiasResp.data || [];

  if (!relatosComBairro.length && !noticias.length) {
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
    <button type="button" class="btn btn-secundario btn-bloco" id="observatorio-baixar-pdf">Baixar em PDF</button>
  `;
  document.getElementById('observatorio-baixar-pdf')?.addEventListener('click', () => window.print());

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
