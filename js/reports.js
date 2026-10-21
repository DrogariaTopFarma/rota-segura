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
  htmlEstadoVazio, htmlCarregando, fecharModal, mostrarMensagem, limparMensagem, validarImagem
} from './ui.js';
import {
  ROTULOS_RELATO, ROTULOS_INCIDENTE_EXTERNO, ICONE_POR_TIPO_RELATO, corDoRelato,
  nivelDeConfiancaTexto, carregarDadosDaAreaVisivel
} from './map.js';
import { criarSeletorLocal } from './location-picker.js';
import { bairroDeCoordenadas } from './geocoding.js';

// Rótulo/cor da camada de VERIFICAÇÃO (diferente de status de moderação,
// que decide se o relato é público — isto decide o quanto confiar nele
// depois de já estar público). "verificado" não tem nenhum jeito de chegar
// lá ainda (ver sql/schema.sql, seção 17.1) — fica pronto na tela pro dia em
// que existir uma fonte de corroboração automática ou confirmação manual.
const ROTULO_VERIFICACAO = {
  nao_verificado: 'Não verificado',
  em_analise: 'Sinalizado pela comunidade',
  verificado: 'Verificado'
};
const TAG_VERIFICACAO = {
  nao_verificado: 'tag--cinza',
  em_analise: 'tag--amarelo',
  verificado: 'tag--verde'
};

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
      .select('id,type,address,occurred_at,attention_level,status,image_url,agrees_count,disagrees_count,expires_at,verification_status,flags_count')
      // Mesmo motivo do filtro em map.js: sem isso, um relato seu expirado
      // (ou ainda não aprovado) continuava aparecendo nesta lista só pra
      // você, mesmo já escondido de todo mundo — a policy de RLS libera ver
      // as próprias linhas sem checar prazo (pensado pra "Meus relatos").
      .eq('status', 'approved')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

  // Voto/denúncia da usuária atual em cada relato, pra já abrir a lista com o
  // botão certo destacado (nunca com tudo "apagado" quando ela já agiu).
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  let votos = new Map();
  let minhasDenuncias = new Set();
  if (user && relatos.length) {
    const idsRelatos = relatos.map((r) => r.id);
    const [{ data: meusVotos }, { data: minhasFlags }] = await Promise.all([
      supabase.from('report_votes').select('report_id,vote')
        .eq('user_id', user.id).in('report_id', idsRelatos),
      supabase.from('report_flags').select('report_id')
        .eq('user_id', user.id).in('report_id', idsRelatos)
    ]);
    votos = new Map((meusVotos || []).map((v) => [v.report_id, v.vote]));
    minhasDenuncias = new Set((minhasFlags || []).map((f) => f.report_id));
  }

  renderizarLista(lista, relatos, noticias, votos, minhasDenuncias);
}

// Quantos cards aparecem de cara em cada grupo antes do "Ver todos" — só
// quando `colapsar` está ligado (lista principal da Tela 1); o preview de
// busca (search.js) já é compacto por conta própria e não usa isso.
const PREVIA_POR_GRUPO = 3;

export function renderizarLista(container, relatos, noticias = [], votos = new Map(), minhasDenuncias = new Set(), { colapsar = true } = {}) {
  if (!relatos.length && !noticias.length) {
    container.innerHTML = htmlEstadoVazio('Nenhum relato registrado ainda. Seja a primeira a contribuir.');
    return;
  }

  const grupoRelatos = montarGrupo({
    tituloSecao: 'Relatos da comunidade',
    tituloBotao: 'Ver todos os relatos da comunidade',
    chave: 'relatos',
    itens: relatos,
    montarCard: (r) => cardRelato(r, votos.get(r.id) || null, minhasDenuncias.has(r.id)),
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

  container.querySelectorAll('.card-lista__voto-btn[data-voto]').forEach((botao) => {
    botao.addEventListener('click', () => alternarVoto(botao.dataset.reportId, botao.dataset.voto, container));
  });

  container.querySelectorAll('.card-lista__voto-btn--denunciar').forEach((botao) => {
    botao.addEventListener('click', () => alternarDenuncia(botao.dataset.reportId, container));
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

function cardRelato(r, votoAtual, jaDenunciado = false) {
  // Mesmo ícone/cor do pino no mapa (map.js) — formato = categoria, cor =
  // gravidade — pra nunca mostrar o mesmo relato de um jeito na lista e de
  // outro no mapa.
  const nomeIcone = ICONE_POR_TIPO_RELATO[r.type] || 'escudo';
  const cor = corDoRelato(r);

  let tag = '<span class="tag tag--rosa">Relato recente</span>';
  if (r.type === 'rua_pouco_iluminada') tag = '<span class="tag tag--amarelo">Atenção</span>';
  if (r.attention_level === 'alto') tag = '<span class="tag tag--vermelho">Alto risco</span>';
  if (r.status === 'pending') tag = '<span class="tag tag--roxo">Em análise</span>';

  // Selo de VERIFICAÇÃO — sempre visível, nunca só quando dá pra desconfiar:
  // mesmo "verificado" aparece, pra deixar claro que um relato comum ainda
  // não passou por nenhuma confirmação além do que a própria comunidade
  // registrou (pedido explícito: relato nunca deve parecer uma certeza).
  const verificacao = r.verification_status || 'nao_verificado';
  const tagVerificacao = `<span class="tag ${TAG_VERIFICACAO[verificacao] || 'tag--cinza'}">${escapar(ROTULO_VERIFICACAO[verificacao] || ROTULO_VERIFICACAO.nao_verificado)}</span>`;

  const expiraTexto = r.expires_at
    ? `<div class="card-lista__meta card-lista__meta--prazo">Visível até ${escapar(formatarDataHora(r.expires_at))}</div>`
    : '';

  return `
    <article class="card-lista">
      <div class="card-lista__icone" style="background:${cor}">${icone(nomeIcone, 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')} ${tagVerificacao}</div>
        <div class="card-lista__meta">${escapar(formatarDataHora(r.occurred_at))}</div>
        <div class="card-lista__endereco">${escapar(r.address || 'Endereço não informado')}</div>
        ${expiraTexto}
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
        <div class="card-lista__votos">
          <button type="button" class="card-lista__voto-btn card-lista__voto-btn--denunciar${jaDenunciado ? ' ativo' : ''}"
                  data-report-id="${r.id}" aria-pressed="${jaDenunciado}">
            ${icone('bandeira', 16)} ${jaDenunciado ? 'Denunciado' : 'Denunciar informação falsa'}
          </button>
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
/* 1.2 DENÚNCIA DE INFORMAÇÃO FALSA                                           */
/* ========================================================================== */

/** Clicar de novo desfaz a denúncia (mesmo gesto de "descurtir" dos votos
    acima) — mas a contagem acumulada que já cruzou o limiar não some: ver
    sync_report_flags_count em sql/schema.sql, o avanço pra "em_analise" é
    só pra frente, nunca desfeito por uma denúncia retirada depois. */
async function alternarDenuncia(reportId, container) {
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  if (!user) return;

  const botao = container.querySelector(`.card-lista__voto-btn--denunciar[data-report-id="${reportId}"]`);
  if (!botao) return;

  const jaDenunciado = botao.classList.contains('ativo');
  botao.disabled = true;

  try {
    if (jaDenunciado) {
      const { error } = await supabase.from('report_flags').delete()
        .eq('report_id', reportId).eq('user_id', user.id);
      if (error) throw error;
      botao.classList.remove('ativo');
      botao.setAttribute('aria-pressed', 'false');
      botao.innerHTML = `${icone('bandeira', 16)} Denunciar informação falsa`;
    } else {
      const { error } = await supabase.from('report_flags')
        .insert({ report_id: reportId, user_id: user.id });
      if (error) throw error;
      botao.classList.add('ativo');
      botao.setAttribute('aria-pressed', 'true');
      botao.innerHTML = `${icone('bandeira', 16)} Denunciado`;
      toast('Obrigada por avisar. Esse relato pode entrar em revisão.', 'sucesso');
    }
  } catch {
    // Causa mais comum: denunciar o próprio relato (a policy do banco
    // recusa por design — ver report_flags_insert_proprio).
    toast('Não foi possível registrar a denúncia agora.', 'erro');
  } finally {
    botao.disabled = false;
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
        const extensao = validarImagem(arquivo);
        const caminho = `${user.id}/relatos/${crypto.randomUUID()}.${extensao}`;
        const { error: erroUpload } = await supabase.storage
          .from('rota-segura')
          .upload(caminho, arquivo, { cacheControl: '3600', upsert: false });
        if (erroUpload) throw erroUpload;
        imageUrl = supabase.storage.from('rota-segura').getPublicUrl(caminho).data.publicUrl;
      }

      const ocorridoEm = new Date(`${form.data.value}T${form.hora.value || '00:00'}`);

      // Prazo de validade é opcional (campo "validade" no form, em horas —
      // vazio = sem prazo, mesmo comportamento de sempre). Contado a partir
      // de AGORA (quando o relato é enviado), não da data/hora do ocorrido —
      // "24h" significa "visível pelas próximas 24h", não "some 24h depois
      // do que aconteceu" (que já podia ter passado há dias).
      const horasValidade = Number(form.validade.value) || 0;
      const expiresAt = horasValidade > 0
        ? new Date(Date.now() + horasValidade * 3600 * 1000).toISOString()
        : null;

      // Bairro resolvido UMA VEZ aqui, no cadastro, e gravado — nunca mais
      // recalculado ao vivo toda vez que o Observatório é aberto (era lento,
      // ~15s+, e dependia do Photon estar no ar bem naquele momento pra
      // TODO MUNDO que abrisse a tela). Falha nisso não impede salvar o
      // relato — bairro fica null e o relato só não entra nos gráficos por
      // região até ser resolvido depois (ver sql/schema.sql, seção 21).
      const bairro = await bairroDeCoordenadas(local.lat, local.lng).catch(() => null);

      const dadosRelato = {
        user_id: user.id,
        type: form.tipo.value,
        description: form.descricao.value.trim() || null,
        address: local.nome,
        lat: local.lat,
        lng: local.lng,
        bairro,
        occurred_at: ocorridoEm.toISOString(),
        attention_level: form.atencao.value,
        image_url: imageUrl,
        expires_at: expiresAt
      };

      let { error } = await supabase.from('reports').insert(dadosRelato);

      // Banco ainda sem a coluna reports.bairro (schema.sql seção 21 não
      // rodou nesse projeto Supabase ainda)? Tenta de novo sem ela, pra
      // cadastrar relato nunca quebrar por causa de uma coluna nova opcional.
      if (error?.message?.includes('bairro')) {
        delete dadosRelato.bairro;
        ({ error } = await supabase.from('reports').insert(dadosRelato));
      }

      if (error) throw error;

      toast('Relato enviado. Obrigada por contribuir.', 'sucesso');
      form.reset();
      seletor.limpar();
      fecharModal('modal-relato');

      await carregarListaRelatos();
      await carregarDadosDaAreaVisivel();
    } catch (erro) {
      console.error(erro);
      const texto = erro.validacaoImagem ? erro.message : traduzirErro(erro);
      mostrarMensagem(msg, texto, 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}

/** Relatos cadastrados ANTES da coluna reports.bairro existir (ver
    sql/schema.sql, seção 21) ficaram com bairro nulo — o Observatório os
    ignora nos gráficos por região até alguém resolver isso. Esta função
    "cura" isso aos poucos: toda vez que a PRÓPRIA autora de um relato antigo
    abre Observatório ou Perfil, resolve o bairro que falta nos relatos DELA
    (nunca de outra pessoa — a policy de RLS só deixa atualizar o que é seu
    mesmo, o que é correto) e grava, silenciosamente, em segundo plano.
    Nunca bloqueia a tela: dispare sem `await` no chamador.

    LIMITE HONESTO: isso só conserta relato de quem realmente abrir o app de
    novo — não é um "conserta tudo de todo mundo de uma vez" (precisaria da
    service_role key, que só o painel do Supabase tem, pra contornar a RLS
    entre usuárias — ver sql/schema.sql, política "relatos_update_proprio").
    Pra maioria dos casos reais (a própria pessoa testando/usando o app)
    isso já resolve; pede uma Edge Function à parte se quiser cobrir também
    relato antigo de conta que ninguém mais vai abrir. */
export async function corrigirBairroDosProprios() {
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  if (!user) return;

  const { data: semBairro, error } = await supabase
    .from('reports')
    .select('id,lat,lng')
    .eq('user_id', user.id)
    .is('bairro', null)
    .limit(30);
  if (error || !semBairro?.length) return;

  for (const relato of semBairro) {
    const bairro = await bairroDeCoordenadas(relato.lat, relato.lng).catch(() => null);
    if (bairro) {
      const { error: erroUpdate } = await supabase.from('reports').update({ bairro }).eq('id', relato.id);
      if (erroUpdate) console.error(erroUpdate);
    }
  }
}
