/* ============================================================================
   ROTA SEGURA — Utilidades de interface
   Toasts, estados de loading, modais, formatação de datas e textos.
   ============================================================================ */

import { icone } from './icons.js';

/* ---------------------------------------------------------------- Toast --- */
function containerToast() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    document.body.appendChild(c);
  }
  return c;
}

/** Mostra um aviso flutuante no topo. tipo: 'info' | 'sucesso' | 'erro' */
export function toast(mensagem, tipo = 'info', duracao = 3800) {
  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.textContent = mensagem;
  containerToast().appendChild(el);
  setTimeout(() => el.remove(), duracao);
}

/* ------------------------------------------------------------- Loading --- */
const textosOriginais = new WeakMap();

/** Coloca (ou tira) o spinner dentro de um botão, bloqueando cliques duplos. */
export function botaoCarregando(botao, carregando, textoCarregando = 'Aguarde...') {
  if (!botao) return;
  if (carregando) {
    if (!textosOriginais.has(botao)) textosOriginais.set(botao, botao.innerHTML);
    botao.disabled = true;
    botao.innerHTML = `<span class="spinner"></span> ${textoCarregando}`;
  } else {
    botao.disabled = false;
    if (textosOriginais.has(botao)) botao.innerHTML = textosOriginais.get(botao);
  }
}

/* ------------------------------------------------------------ Mensagens --- */
/** Mostra uma mensagem fixa dentro de um container (#mensagem-erro etc). */
export function mostrarMensagem(container, texto, tipo = 'erro') {
  if (!container) return;
  container.className = `mensagem mensagem--${tipo}`;
  container.textContent = texto;
  container.hidden = false;
}

export function limparMensagem(container) {
  if (!container) return;
  container.hidden = true;
  container.textContent = '';
}

/** Bloco de "nada aqui ainda". */
export function htmlEstadoVazio(texto) {
  return `<div class="estado-vazio">${icone('vazio', 40)}<p>${escapar(texto)}</p></div>`;
}

/** Blocos cinza animados enquanto os dados carregam. */
export function htmlCarregando(qtd = 2) {
  return Array.from({ length: qtd }, () => '<div class="skeleton skeleton-linha"></div>').join('');
}

/* --------------------------------------------------------------- Modal --- */
let ultimoFoco = null;

export function abrirModal(idModal) {
  const modal = document.getElementById(idModal);
  if (!modal) return;
  ultimoFoco = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const primeiro = modal.querySelector('button, input, select, textarea, a[href]');
  if (primeiro) primeiro.focus();
}

export function fecharModal(idModal) {
  const modal = document.getElementById(idModal);
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  if (ultimoFoco) ultimoFoco.focus();
}

/** Liga: clicar fora fecha, botão [data-fechar] fecha, tecla Esc fecha. */
export function prepararModais() {
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fecharModal(modal.id);
    });
    modal.querySelectorAll('[data-fechar]').forEach((btn) => {
      btn.addEventListener('click', () => fecharModal(modal.id));
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal:not([hidden])').forEach((m) => fecharModal(m.id));
  });
}

/** Botões [data-trocar-modal="idDoModal"]: fecha o modal em que o botão está
    (o mais próximo na árvore) e abre outro — usado pelos itens do menu que
    levam a outro painel (Notificações, Termos, Privacidade). Diferente do
    fluxo de "o que deseja cadastrar", que sempre parte do mesmo modal. */
export function prepararTrocaDeModal() {
  document.querySelectorAll('[data-trocar-modal]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const atual = botao.closest('.modal');
      if (atual) fecharModal(atual.id);
      setTimeout(() => abrirModal(botao.dataset.trocarModal), 120);
    });
  });
}

/* ---------------------------------------------------------- Formatação --- */
export function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

/** "Hoje, 08:23" / "Ontem, 21:15" / "12/08, 19:40" */
export function formatarDataHora(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  const agora = new Date();
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const mesmoDia = (a, b) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);

  if (mesmoDia(data, agora)) return `Hoje, ${hora}`;
  if (mesmoDia(data, ontem)) return `Ontem, ${hora}`;
  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hora}`;
}

/* --------------------------------------------------------- Diversos ------ */
/** Espera o usuário parar de digitar antes de executar (evita excesso de chamadas). */
export function debounce(fn, ms = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Distância em metros entre dois pontos (fórmula de Haversine). */
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
