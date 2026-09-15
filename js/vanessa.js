/* ============================================================================
   ROTA SEGURA — Vanessa (chat de IA da Comunidade, Tela 3)

   Responde só dois assuntos: segurança pessoal/nas ruas, e como usar o Rota
   Segura (ver o prompt completo em supabase/functions/perguntar-vanessa/
   index.ts — é lá que a regra de escopo é aplicada de verdade, não aqui).

   DECISÃO DE ESCOPO (v1): o histórico da conversa vive só em memória desta
   aba/sessão — não é salvo no banco. Fechar a aba ou recarregar a página
   começa uma conversa nova. Simples de propósito: nenhuma outra parte do
   app precisa dessas mensagens depois, e evita ter que pensar em RLS/
   retenção de dados pra isso agora.
   ============================================================================ */

import { supabase } from './supabase.js';
import { abrirModal } from './ui.js';

const PERGUNTAS_FREQUENTES = [
  'Como cadastro um relato de segurança?',
  'O que eu faço se perceber que estão me seguindo?',
  'Como funciona o Acompanhar corrida?',
  'Como cadastro um contato de emergência?'
];

let historico = []; // { papel: 'usuaria'|'vanessa', texto }[]
let enviando = false;

export function prepararChatVanessa() {
  const botaoAbrir = document.getElementById('abrir-vanessa');
  if (!botaoAbrir) return; // página sem o chat da Vanessa

  botaoAbrir.addEventListener('click', () => {
    abrirModal('modal-vanessa');
    document.getElementById('vanessa-input')?.focus();
  });

  document.getElementById('vanessa-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('vanessa-input');
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';
    enviarPergunta(texto);
  });

  mostrarChipsIniciais();
}

function mostrarChipsIniciais() {
  const chips = document.getElementById('vanessa-chips');
  if (!chips) return;
  chips.innerHTML = PERGUNTAS_FREQUENTES
    .map((p, i) => `<button type="button" data-i="${i}">${p}</button>`)
    .join('');
  chips.querySelectorAll('button[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => enviarPergunta(PERGUNTAS_FREQUENTES[Number(btn.dataset.i)]));
  });
}

function adicionarBolha(papel, texto) {
  const lista = document.getElementById('vanessa-mensagens');
  if (!lista) return null;
  const bolha = document.createElement('div');
  bolha.className = `vanessa-bolha vanessa-bolha--${papel}`;
  bolha.textContent = texto; // textContent (não innerHTML) — sem risco de HTML/script injetado
  lista.appendChild(bolha);
  lista.scrollTop = lista.scrollHeight;
  return bolha;
}

/** Mesmo padrão de extração de erro já usado em js/routes.js
    (extrairMensagemDeErro): quando a Edge Function responde com status de
    erro, o supabase-js só coloca o corpo em `error.context`, nunca em `data`. */
async function extrairMensagemDeErro(error) {
  try {
    if (error?.context?.json) {
      const corpo = await error.context.json();
      if (corpo?.erro) return corpo.erro;
    }
  } catch {
    // corpo não veio em JSON (ex.: função fora do ar) — usa a mensagem genérica abaixo
  }
  return 'Não consegui falar com a Vanessa agora. Tente de novo em instantes.';
}

async function enviarPergunta(texto) {
  if (enviando || !texto) return;
  enviando = true;

  document.getElementById('vanessa-chips')?.replaceChildren();
  adicionarBolha('usuaria', texto);
  const historicoAntesDestaPergunta = [...historico];
  historico.push({ papel: 'usuaria', texto });

  const indicador = adicionarBolha('vanessa', 'Digitando...');
  indicador?.classList.add('vanessa-bolha--digitando');

  try {
    const { data, error } = await supabase.functions.invoke('perguntar-vanessa', {
      body: { pergunta: texto, historico: historicoAntesDestaPergunta }
    });
    if (error) throw error;

    indicador?.remove();
    const resposta = data?.resposta || 'Não consegui pensar numa resposta agora. Tente de novo.';
    adicionarBolha('vanessa', resposta);
    historico.push({ papel: 'vanessa', texto: resposta });
  } catch (erro) {
    indicador?.remove();
    console.error(erro);
    adicionarBolha('vanessa', await extrairMensagemDeErro(erro));
  } finally {
    enviando = false;
  }
}
