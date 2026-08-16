/* ============================================================================
   ROTA SEGURA — Relatos de segurança
   Lista abaixo do mapa + formulário de cadastro (salva de verdade no Supabase).

   MUDANÇA IMPORTANTE:
   O local do relato agora vem do seletor com mini-mapa (location-picker.js).
   Ele começa VAZIO toda vez que o formulário abre, e não tem nenhuma ligação
   com o que você pesquisou no mapa principal. O relato só é salvo depois de
   você ver o pino no lugar certo.
   ============================================================================ */

import { supabase, traduzirErro } from './supabase.js';
import { icone } from './icons.js';
import {
  toast, escapar, formatarDataHora, botaoCarregando,
  htmlEstadoVazio, htmlCarregando, fecharModal, mostrarMensagem, limparMensagem
} from './ui.js';
import { ROTULOS_RELATO, carregarDadosDaAreaVisivel } from './map.js';
import { criarSeletorLocal } from './location-picker.js';

let seletor = null;

/** Deixa o seletor de local acessível para o app.js (abrir/limpar o modal). */
export function seletorDeLocalDoRelato() { return seletor; }

/* ========================================================================== */
/* 1. LISTA "Relatos de segurança"                                            */
/* ========================================================================== */

export async function carregarListaRelatos() {
  const lista = document.getElementById('lista-relatos');
  if (!lista) return;

  lista.innerHTML = htmlCarregando(2);

  const { data, error } = await supabase
    .from('reports')
    .select('id,type,address,occurred_at,attention_level,status')
    .order('occurred_at', { ascending: false })
    .limit(6);

  if (error) {
    lista.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar os dados. Tente novamente.</div>`;
    return;
  }

  renderizarLista(lista, data || []);
}

export function renderizarLista(container, dados) {
  if (!dados.length) {
    container.innerHTML = htmlEstadoVazio('Nenhum relato registrado ainda. Seja a primeira a contribuir.');
    return;
  }

  container.innerHTML = dados.map((r) => {
    const iluminacao = r.type === 'rua_pouco_iluminada';
    const classeIcone = iluminacao ? 'card-lista__icone--atencao' : '';
    const nomeIcone = iluminacao ? 'lampada' : 'escudo';

    let tag = '<span class="tag tag--rosa">Relato recente</span>';
    if (iluminacao) tag = '<span class="tag tag--amarelo">Atenção</span>';
    if (r.attention_level === 'alto') tag = '<span class="tag tag--vermelho">Alto risco</span>';
    if (r.status === 'pending') tag = '<span class="tag tag--roxo">Em análise</span>';

    return `
      <article class="card-lista">
        <div class="card-lista__icone ${classeIcone}">${icone(nomeIcone, 22)}</div>
        <div class="card-lista__conteudo">
          <div class="card-lista__titulo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
          <div class="card-lista__meta">${escapar(formatarDataHora(r.occurred_at))}</div>
          <div class="card-lista__endereco">${escapar(r.address || 'Endereço não informado')}</div>
        </div>
        ${tag}
      </article>`;
  }).join('');
}

/* ========================================================================== */
/* 2. FORMULÁRIO DE RELATO                                                    */
/* ========================================================================== */

export function prepararFormularioRelato() {
  const form = document.getElementById('form-relato');
  if (!form) return;

  const msg = document.getElementById('mensagem-relato');

  seletor = criarSeletorLocal({
    mapa: 'relato-mini-mapa',
    busca: 'relato-busca-local',
    sugestoes: 'relato-sugestoes',
    resumo: 'relato-local-escolhido',
    botaoGps: 'relato-usar-localizacao',
    ajuste: 'relato-ajuste'
  });

  // Preenche data e hora com o momento atual
  const agora = new Date();
  form.data.value = agora.toISOString().slice(0, 10);
  form.hora.value = agora.toTimeString().slice(0, 5);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    const local = seletor.valor();

    if (!form.tipo.value) {
      return mostrarMensagem(msg, 'Escolha o tipo de ocorrência.', 'atencao');
    }
    if (!local) {
      return mostrarMensagem(
        msg,
        'Ainda não temos o local. Toque em "Usar minha localização" ou corrija o endereço em "Não é aqui?".',
        'atencao'
      );
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Enviando...');

    try {
      const { data: sessao } = await supabase.auth.getUser();
      const user = sessao?.user;
      if (!user) throw new Error('session');

      // Upload da imagem (opcional)
      let imageUrl = null;
      const arquivo = form.imagem.files?.[0];
      if (arquivo) {
        if (arquivo.size > 5 * 1024 * 1024) {
          throw new Error('A imagem precisa ter no máximo 5 MB.');
        }
        const extensao = arquivo.name.split('.').pop().toLowerCase();
        const caminho = `${user.id}/relatos/${crypto.randomUUID()}.${extensao}`;
        const { error: erroUpload } = await supabase.storage
          .from('rota-segura')
          .upload(caminho, arquivo, { cacheControl: '3600', upsert: false });
        if (erroUpload) throw erroUpload;
        imageUrl = supabase.storage.from('rota-segura').getPublicUrl(caminho).data.publicUrl;
      }

      const ocorridoEm = new Date(`${form.data.value}T${form.hora.value || '00:00'}`);

      const { error } = await supabase.from('reports').insert({
        user_id: user.id,
        type: form.tipo.value,
        description: form.descricao.value.trim() || null,
        address: local.nome,
        lat: local.lat,
        lng: local.lng,
        occurred_at: ocorridoEm.toISOString(),
        attention_level: form.atencao.value,
        image_url: imageUrl
      });

      if (error) throw error;

      toast('Relato enviado. Obrigada por contribuir.', 'sucesso');
      form.reset();
      seletor.limpar();
      fecharModal('modal-relato');

      await carregarListaRelatos();
      await carregarDadosDaAreaVisivel();
    } catch (erro) {
      console.error(erro);
      const texto = erro.message?.includes('5 MB') ? erro.message : traduzirErro(erro);
      mostrarMensagem(msg, texto, 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}
