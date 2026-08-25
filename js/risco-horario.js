/* ============================================================================
   ROTA SEGURA — Painel "Horário mais arriscado" (Tela 1 — Mapa)

   Não faz nenhuma consulta própria ao banco: reaproveita os mesmos relatos e
   notícias públicas que já foram carregados pra desenhar os pinos da área
   visível (map.js, dadosAtuaisDaArea()) — nunca busca dado à parte, que
   poderia divergir do que está no mapa.

   Só CONTAGEM por período do dia, calculada aqui mesmo com dado real —
   nunca uma estimativa ou número inventado. Áreas com poucos relatos
   simplesmente mostram poucos ou nenhum registro; não tenta "completar"
   isso com uma extrapolação.
   ============================================================================ */

import { escapar } from './ui.js';
import { dadosAtuaisDaArea, aoAtualizarRelatos } from './map.js';

const PERIODOS = [
  { rotulo: 'Madrugada', faixa: '0h–6h', inicio: 0, fim: 6 },
  { rotulo: 'Manhã', faixa: '6h–12h', inicio: 6, fim: 12 },
  { rotulo: 'Tarde', faixa: '12h–18h', inicio: 12, fim: 18 },
  { rotulo: 'Noite', faixa: '18h–24h', inicio: 18, fim: 24 }
];

/** Em qual dos 4 períodos uma data (ISO) cai, pela hora LOCAL do aparelho —
    mesmo critério que o resto do app já usa pra mostrar hora (formatarData/
    formatarDataHora em ui.js), então o período aqui bate com o que a
    usuária vê escrito nos cards. */
function periodoDoDia(iso) {
  if (!iso) return null;
  const hora = new Date(iso).getHours();
  return PERIODOS.findIndex((p) => hora >= p.inicio && hora < p.fim);
}

/** Pura, testável sem DOM: soma relatos + notícias públicas nos 4 períodos.
    `relatos` usa occurred_at; `noticias` usa occurred_at OU published_at
    (mesma regra de fallback já usada em reports.js pra ordenar a lista). */
export function calcularContagensPorPeriodo(relatos, noticias) {
  const contagens = PERIODOS.map(() => 0);
  for (const r of relatos || []) {
    const indice = periodoDoDia(r.occurred_at);
    if (indice >= 0) contagens[indice]++;
  }
  for (const n of noticias || []) {
    const indice = periodoDoDia(n.occurred_at || n.published_at);
    if (indice >= 0) contagens[indice]++;
  }
  return contagens;
}

function renderizarGrafico(container, contagens) {
  const total = contagens.reduce((a, b) => a + b, 0);
  if (!total) {
    container.innerHTML = '<p class="risco-horario__vazio">Sem relatos ou notícias suficientes nesta área pra mostrar um padrão por horário.</p>';
    return;
  }

  const maior = Math.max(...contagens, 1);
  container.innerHTML = `
    <div class="risco-horario__grafico" role="img"
         aria-label="${escapar(PERIODOS.map((p, i) => `${p.rotulo}, ${p.faixa}: ${contagens[i]} registro${contagens[i] === 1 ? '' : 's'}`).join('. '))}">
      ${PERIODOS.map((p, i) => `
        <div class="risco-horario__linha">
          <span class="risco-horario__rotulo">${escapar(p.rotulo)}<small>${escapar(p.faixa)}</small></span>
          <div class="risco-horario__trilha">
            <div class="risco-horario__barra" style="width:${Math.round((contagens[i] / maior) * 100)}%"></div>
          </div>
          <span class="risco-horario__valor">${contagens[i]}</span>
        </div>`).join('')}
    </div>
    <p class="risco-horario__legenda">Soma de relatos e notícias públicas com data conhecida, nesta área do mapa.</p>`;
}

export function carregarRiscoPorHorario() {
  const container = document.getElementById('risco-horario');
  if (!container) return;
  const { relatos, noticias } = dadosAtuaisDaArea();
  renderizarGrafico(container, calcularContagensPorPeriodo(relatos, noticias));
}

/** Liga o painel pra se atualizar sozinho toda vez que a área visível do
    mapa recarrega (mesmo gancho que já existe pra outras peças pequenas,
    ex.: js/push.js) — chama uma vez já de cara também. */
export function ligarRiscoPorHorario() {
  carregarRiscoPorHorario();
  aoAtualizarRelatos(() => carregarRiscoPorHorario());
}
