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
import {
  ROTULOS_RELATO, ROTULOS_INCIDENTE_EXTERNO, nivelDeConfiancaTexto, carregarDadosDaAreaVisivel
} from './map.js';
import { criarSeletorLocal } from './location-picker.js';

let seletor = null;

/** Deixa o seletor de local acessível para o app.js (abrir/limpar o modal). */
export function seletorDeLocalDoRelato() { return seletor; }

/* ========================================================================== */
/* 1. LISTA "Relatos de segurança"                                            */
/* ========================================================================== */

// Sem "Ver todos": a lista já mostra tudo aqui mesmo (limite técnico alto
// só pra nunca travar a tela numa conta com centenas de relatos/notícias).
export async function carregarListaRelatos() {
  const lista = document.getElementById('lista-relatos');
  if (!lista) return;

  lista.innerHTML = htmlCarregando(2);

  // Notícias públicas entram na MESMA lista dos relatos (a pedido), não como
  // tela separada — ordenadas por published_at (quase sempre presente, ao
  // contrário de occurred_at, que a IA só preenche quando o texto tem uma
  // data explícita) pra não perder itens recentes no corte do .limit(100).
  const [relatosResp, noticiasResp] = await Promise.all([
    supabase.from('reports')
      .select('id,type,address,occurred_at,attention_level,status,image_url,agrees_count,disagrees_count')
      .order('occurred_at', { ascending: false })
      .limit(100),
    supabase.from('external_incidents')
      .select('id,category,title,description,address,city,source_url,confidence,occurred_at,published_at,matched_report_id')
      .in('status', ['active', 'confirmed'])
      .order('published_at', { ascending: false })
      .limit(100)
  ]);

  if (relatosResp.error) {
    lista.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar os dados. Tente novamente.</div>`;
    return;
  }

  const relatos = (relatosResp.data || []).map((r) => ({ ...r, _tipo: 'relato', _data: r.occurred_at }));
  // Se a busca de notícias falhar (RLS, rede), a lista de relatos continua
  // aparecendo normalmente — só não mostra a parte de notícias desta vez.
  const noticias = (noticiasResp.data || []).map((n) => ({ ...n, _tipo: 'noticia', _data: n.occurred_at || n.published_at }));

  const itens = [...relatos, ...noticias].sort((a, b) => new Date(b._data || 0) - new Date(a._data || 0));

  // Voto da usuária atual em cada relato, pra já abrir a lista com o botão
  // certo destacado (nunca com os dois "apagados" quando ela já votou).
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  let votos = new Map();
  if (user && relatos.length) {
    const { data: meusVotos } = await supabase
      .from('report_votes')
      .select('report_id,vote')
      .eq('user_id', user.id)
      .in('report_id', relatos.map((r) => r.id));
    votos = new Map((meusVotos || []).map((v) => [v.report_id, v.vote]));
  }

  renderizarLista(lista, itens, votos);
}

export function renderizarLista(container, dados, votos = new Map()) {
  if (!dados.length) {
    container.innerHTML = htmlEstadoVazio('Nenhum relato registrado ainda. Seja a primeira a contribuir.');
    return;
  }

  container.innerHTML = dados
    .map((item) => (item._tipo === 'noticia' ? cardNoticia(item) : cardRelato(item, votos.get(item.id) || null)))
    .join('');

  container.querySelectorAll('.card-lista__voto-btn').forEach((botao) => {
    botao.addEventListener('click', () => alternarVoto(botao.dataset.reportId, botao.dataset.voto, container));
  });
}

function textoPercentual(agrees, disagrees) {
  const total = (agrees || 0) + (disagrees || 0);
  if (!total) return 'Ainda sem votos';
  return `${Math.round((agrees / total) * 100)}% concordam (${total} ${total === 1 ? 'voto' : 'votos'})`;
}

function cardRelato(r, votoAtual) {
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
        ${r.image_url ? `
          <button type="button" class="card-lista__foto" data-ampliar-foto="${escapar(r.image_url)}">
            <img src="${escapar(r.image_url)}" alt="Foto anexada ao relato" loading="lazy">
          </button>` : ''}
        <div class="card-lista__votos">
          <button type="button" class="card-lista__voto-btn card-lista__voto-btn--concordo${votoAtual === 'concordo' ? ' ativo' : ''}"
                  data-report-id="${r.id}" data-voto="concordo" aria-pressed="${votoAtual === 'concordo'}">
            ${icone('votoPositivo', 16)} Concordo
          </button>
          <button type="button" class="card-lista__voto-btn card-lista__voto-btn--discordo${votoAtual === 'discordo' ? ' ativo' : ''}"
                  data-report-id="${r.id}" data-voto="discordo" aria-pressed="${votoAtual === 'discordo'}">
            ${icone('votoNegativo', 16)} Discordo
          </button>
          <span class="card-lista__percentual" data-percentual="${r.id}">${textoPercentual(r.agrees_count, r.disagrees_count)}</span>
        </div>
      </div>
      ${tag}
    </article>`;
}

function cardNoticia(n) {
  const dataTexto = n.occurred_at || n.published_at ? formatarDataHora(n.occurred_at || n.published_at) : null;
  return `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--teal">${icone('megafone', 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(n.title)}</div>
        ${dataTexto ? `<div class="card-lista__meta">${escapar(dataTexto)}</div>` : ''}
        <div class="card-lista__endereco">${escapar(n.address || n.city || '')}</div>
        ${n.description ? `<div class="card-lista__desc">${escapar(n.description)}</div>` : ''}
        <div class="card-lista__meta">
          ${n.matched_report_id ? 'Notícia + relato da comunidade' : 'Fonte: notícia pública'}
          · Confiança: ${nivelDeConfiancaTexto(n.confidence)}
        </div>
        ${n.source_url ? `<a class="card-lista__link" href="${escapar(n.source_url)}" target="_blank" rel="noopener">Ver notícia original</a>` : ''}
      </div>
      <span class="tag tag--teal">${escapar(ROTULOS_INCIDENTE_EXTERNO[n.category] || 'Notícia pública')}</span>
    </article>`;
}

/* ========================================================================== */
/* 1.1 VALIDAÇÃO DE RELATO (concordo/discordo)                                */
/* ========================================================================== */

function atualizarBotoesVoto(botaoConcordo, botaoDiscordo, votoAtivo) {
  botaoConcordo.classList.toggle('ativo', votoAtivo === 'concordo');
  botaoConcordo.setAttribute('aria-pressed', String(votoAtivo === 'concordo'));
  botaoDiscordo.classList.toggle('ativo', votoAtivo === 'discordo');
  botaoDiscordo.setAttribute('aria-pressed', String(votoAtivo === 'discordo'));
}

async function alternarVoto(reportId, voto, container) {
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  if (!user) return;

  const botaoConcordo = container.querySelector(`.card-lista__voto-btn--concordo[data-report-id="${reportId}"]`);
  const botaoDiscordo = container.querySelector(`.card-lista__voto-btn--discordo[data-report-id="${reportId}"]`);
  const percentualEl = container.querySelector(`.card-lista__percentual[data-percentual="${reportId}"]`);
  if (!botaoConcordo || !botaoDiscordo || !percentualEl) return;

  const votoAtual = botaoConcordo.classList.contains('ativo') ? 'concordo'
    : botaoDiscordo.classList.contains('ativo') ? 'discordo' : null;

  botaoConcordo.disabled = true;
  botaoDiscordo.disabled = true;

  try {
    if (votoAtual === voto) {
      // Tocar de novo no voto já ativo remove o voto (mesmo gesto de
      // "descurtir" que a Comunidade já usa).
      const { error } = await supabase.from('report_votes').delete()
        .eq('report_id', reportId).eq('user_id', user.id);
      if (error) throw error;
      atualizarBotoesVoto(botaoConcordo, botaoDiscordo, null);
    } else {
      const { error } = await supabase.from('report_votes')
        .upsert({ report_id: reportId, user_id: user.id, vote: voto }, { onConflict: 'report_id,user_id' });
      if (error) throw error;
      atualizarBotoesVoto(botaoConcordo, botaoDiscordo, voto);
    }

    // Os contadores reais vêm do gatilho no banco (sql/schema.sql,
    // sync_report_votes_count) — busca de novo em vez de tentar adivinhar o
    // número certo no client, que erraria fácil numa troca de voto.
    const { data: atualizado } = await supabase
      .from('reports').select('agrees_count,disagrees_count').eq('id', reportId).maybeSingle();
    if (atualizado) {
      percentualEl.textContent = textoPercentual(atualizado.agrees_count, atualizado.disagrees_count);
    }
  } catch {
    toast('Não foi possível registrar seu voto agora. Tente de novo.', 'erro');
  } finally {
    botaoConcordo.disabled = false;
    botaoDiscordo.disabled = false;
  }
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
