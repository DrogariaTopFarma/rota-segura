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

  // Notícias públicas aparecem na mesma tela dos relatos, mas em seção
  // PRÓPRIA — intercalar tudo numa linha do tempo só (testado antes) ficou
  // confuso, difícil de separar "isso é da comunidade" de "isso é notícia".
  const [relatosResp, noticiasResp] = await Promise.all([
    supabase.from('reports')
      .select('id,type,address,occurred_at,attention_level,status,image_url,agrees_count,disagrees_count')
      .order('occurred_at', { ascending: false })
      .limit(100),
    // published_at (quase sempre presente) em vez de occurred_at (só quando
    // a IA acha uma data explícita no texto), pra não perder item recente
    // no corte do .limit(100).
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

  const relatos = relatosResp.data || [];
  // Se a busca de notícias falhar (RLS, rede), a lista de relatos continua
  // aparecendo normalmente — só não mostra a seção de notícias desta vez.
  const noticias = noticiasResp.data || [];

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

  renderizarLista(lista, relatos, noticias, votos);
}

// Quantos cards aparecem de cara em cada grupo antes do "Ver todos" — só
// quando `colapsar` está ligado (lista principal da Tela 1); o preview de
// busca (search.js) já é compacto por conta própria e não usa isso.
const PREVIA_POR_GRUPO = 3;

export function renderizarLista(container, relatos, noticias = [], votos = new Map(), { colapsar = true } = {}) {
  if (!relatos.length && !noticias.length) {
    container.innerHTML = htmlEstadoVazio('Nenhum relato registrado ainda. Seja a primeira a contribuir.');
    return;
  }

  const grupoRelatos = montarGrupo({
    tituloSecao: 'Relatos da comunidade',
    tituloBotao: 'Ver todos os relatos da comunidade',
    chave: 'relatos',
    itens: relatos,
    montarCard: (r) => cardRelato(r, votos.get(r.id) || null),
    colapsar
  });

  const grupoNoticias = montarGrupo({
    tituloSecao: 'Notícias públicas',
    tituloBotao: 'Ver todos os relatos públicos',
    chave: 'noticias',
    itens: noticias,
    montarCard: cardNoticia,
    colapsar
  });

  container.innerHTML = grupoRelatos + grupoNoticias;

  container.querySelectorAll('.card-lista__voto-btn').forEach((botao) => {
    botao.addEventListener('click', () => alternarVoto(botao.dataset.reportId, botao.dataset.voto, container));
  });

  // "Ver todos": só revela os cards já renderizados (escondidos por CSS) —
  // sem re-render, sem nova consulta ao banco. O botão some depois de usado.
  container.querySelectorAll('[data-expandir-grupo]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const chave = botao.dataset.expandirGrupo;
      container.querySelectorAll(`[data-oculto-do-grupo="${chave}"]`).forEach((el) => { el.hidden = false; });
      botao.remove();
    });
  });
}

function montarGrupo({ tituloSecao, tituloBotao, chave, itens, montarCard, colapsar }) {
  if (!itens.length) return '';

  const limite = colapsar ? PREVIA_POR_GRUPO : itens.length;
  const cardsHtml = itens.map((item, i) => {
    const html = montarCard(item);
    if (i < limite) return html;
    // Continuam no DOM (não é paginação de verdade) — só ficam escondidos
    // até "Ver todos", então os botões de voto já funcionam assim que
    // aparecerem, sem religar handler nenhum.
    return `<div data-oculto-do-grupo="${chave}" hidden>${html}</div>`;
  }).join('');

  const restantes = itens.length - limite;
  const botaoVerTodos = restantes > 0
    ? `<button type="button" class="btn btn-texto lista-relatos__ver-todos" data-expandir-grupo="${chave}">${escapar(tituloBotao)} (${itens.length})</button>`
    : '';

  return `
    <div class="lista-relatos__grupo">
      <div class="lista-relatos__grupo-titulo">${escapar(tituloSecao)}</div>
      ${cardsHtml}
      ${botaoVerTodos}
    </div>`;
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
