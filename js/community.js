/* ============================================================================
   ROTA SEGURA — Comunidade (Bloco 3)

   Interação social: curtir/descurtir e comentar. O banco já impede curtir
   duas vezes a mesma publicação (unique(post_id,user_id) em post_likes) e já
   mantém posts.likes_count/comments_count sincronizados sozinhos via gatilho
   — aqui só chamamos insert/delete, nunca escrevemos os contadores à mão.
   ============================================================================ */

import { supabase, traduzirErro } from './supabase.js';
import { icone } from './icons.js';
import {
  toast, escapar, formatarDataHora, botaoCarregando,
  htmlEstadoVazio, htmlCarregando, abrirModal, fecharModal, mostrarMensagem, limparMensagem
} from './ui.js';
import { criarSeletorLocal } from './location-picker.js';

const ROTULOS_CATEGORIA = { alerta: 'Alerta', dica: 'Dica', apoio: 'Apoio', noticia: 'Notícia' };
const COR_CATEGORIA = { alerta: 'vermelho', dica: 'amarelo', apoio: 'verde', noticia: 'roxo' };

let seletorPublicacao = null;
let filtroAtual = null;

/* ========================================================================== */
/* 1. FEED                                                                    */
/* ========================================================================== */

export async function carregarFeed(filtro = filtroAtual) {
  filtroAtual = filtro;
  const container = document.getElementById('comunidade-feed');
  if (!container) return;
  container.innerHTML = htmlCarregando(3);

  // posts_publico (não a tabela posts direto): já vem com o user_id trocado
  // por null quando a publicação é anônima — a identidade de quem postou
  // nunca chega até aqui pra ser escondida só na tela (ver sql/schema.sql).
  let consulta = supabase
    .from('posts_publico')
    .select('id,user_id,category,title,content,address,lat,lng,image_url,likes_count,comments_count,created_at,is_anonymous')
    .order('created_at', { ascending: false })
    .limit(50);
  if (filtro) consulta = consulta.eq('category', filtro);

  const { data, error } = await consulta;
  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar a comunidade. Tente novamente.</div>`;
    return;
  }

  const posts = data || [];
  if (!posts.length) {
    // Mensagem diferente quando é o filtro que está vazio (pode haver
    // publicações em outras categorias) do que quando a comunidade toda
    // ainda não tem nada — a mesma frase nos dois casos confundia.
    const texto = filtro
      ? `Nenhuma publicação em "${ROTULOS_CATEGORIA[filtro] || filtro}" ainda.`
      : 'Nenhuma publicação por aqui ainda. Seja a primeira a compartilhar.';
    container.innerHTML = htmlEstadoVazio(texto);
    return;
  }

  // Nome/avatar de quem publicou — busca separada (mais simples e previsível
  // do que depender de embed automático do PostgREST entre posts e profiles).
  // Publicações anônimas já chegam aqui com user_id nulo (a view cuida
  // disso), então nem entram nesta lista — o perfil delas nunca é buscado.
  const idsAutores = [...new Set(posts.map((p) => p.user_id).filter(Boolean))];
  const autores = {};
  if (idsAutores.length) {
    const { data: perfis } = await supabase
      .from('profiles')
      .select('id,full_name,avatar_url')
      .in('id', idsAutores);
    (perfis || []).forEach((p) => { autores[p.id] = p; });
  }

  // Quais dessas publicações a usuária atual já curtiu
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  let curtidos = new Set();
  if (user) {
    const { data: likes } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', user.id)
      .in('post_id', posts.map((p) => p.id));
    curtidos = new Set((likes || []).map((l) => l.post_id));
  }

  renderizarFeed(container, posts, autores, curtidos);
}

function renderizarFeed(container, posts, autores, curtidos) {
  container.innerHTML = posts.map((p) => {
    const autor = p.is_anonymous ? null : autores[p.user_id];
    const nome = p.is_anonymous ? 'Anônimo' : (autor?.full_name || 'Alguém da comunidade');
    const avatar = autor?.avatar_url
      ? `<img src="${escapar(autor.avatar_url)}" alt="">`
      : icone('perfil', 20);
    const jaCurtido = curtidos.has(p.id);
    const cor = COR_CATEGORIA[p.category] || 'rosa';

    return `
      <article class="post-card">
        <div class="post-card__topo">
          <div class="post-card__avatar">${avatar}</div>
          <div class="post-card__autor">
            <div class="post-card__nome">${escapar(nome)}</div>
            <div class="post-card__hora">${escapar(formatarDataHora(p.created_at))}</div>
          </div>
          <span class="tag tag--${cor}">${escapar(ROTULOS_CATEGORIA[p.category] || 'Publicação')}</span>
        </div>
        ${p.title ? `<h3 class="post-card__titulo">${escapar(p.title)}</h3>` : ''}
        <p class="post-card__conteudo">${escapar(p.content)}</p>
        ${p.address ? `
          <div class="post-card__local">${icone('pino', 14)}<span>${escapar(p.address)}</span></div>
        ` : ''}
        ${p.image_url ? `<img class="post-card__imagem" src="${escapar(p.image_url)}" alt="">` : ''}
        <div class="post-card__acoes">
          <button type="button" class="post-card__curtir${jaCurtido ? ' ativo' : ''}"
                  data-post-id="${p.id}" data-curtido="${jaCurtido}"
                  aria-pressed="${jaCurtido}" aria-label="Curtir publicação de ${escapar(nome)}">
            ${icone('coracao', 18)} <span>${p.likes_count}</span>
          </button>
          <button type="button" class="post-card__comentar"
                  data-post-id="${p.id}" aria-label="Ver comentários da publicação de ${escapar(nome)}">
            ${icone('comentario', 18)} <span>${p.comments_count || 0}</span>
          </button>
        </div>
      </article>`;
  }).join('');

  container.querySelectorAll('.post-card__curtir').forEach((botao) => {
    botao.addEventListener('click', () => {
      alternarCurtida(botao.dataset.postId, botao.dataset.curtido === 'true', botao);
    });
  });

  container.querySelectorAll('.post-card__comentar').forEach((botao) => {
    botao.addEventListener('click', () => abrirComentarios(botao.dataset.postId));
  });
}

async function alternarCurtida(postId, jaCurtido, botao) {
  const { data: sessao } = await supabase.auth.getUser();
  const user = sessao?.user;
  if (!user) return;

  botao.disabled = true;
  const contador = botao.querySelector('span');
  const atual = Number(contador.textContent) || 0;

  try {
    if (jaCurtido) {
      const { error } = await supabase
        .from('post_likes').delete()
        .eq('post_id', postId).eq('user_id', user.id);
      if (error) throw error;
      botao.classList.remove('ativo');
      botao.dataset.curtido = 'false';
      botao.setAttribute('aria-pressed', 'false');
      contador.textContent = String(Math.max(atual - 1, 0));
    } else {
      const { error } = await supabase
        .from('post_likes').insert({ post_id: postId, user_id: user.id });
      if (error) throw error;
      botao.classList.add('ativo');
      botao.dataset.curtido = 'true';
      botao.setAttribute('aria-pressed', 'true');
      contador.textContent = String(atual + 1);
    }
  } catch {
    toast('Não foi possível registrar a curtida agora. Tente de novo.', 'erro');
  } finally {
    botao.disabled = false;
  }
}

/* ========================================================================== */
/* 1.1 COMENTÁRIOS                                                            */
/* ========================================================================== */

let postIdComentarios = null;

async function abrirComentarios(postId) {
  postIdComentarios = postId;
  abrirModal('modal-comentarios');
  await carregarComentarios(postId);
}

async function carregarComentarios(postId) {
  const lista = document.getElementById('comentarios-lista');
  if (!lista) return;
  lista.innerHTML = htmlCarregando(2);

  const { data, error } = await supabase
    .from('post_comments')
    .select('id,user_id,content,created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) {
    lista.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar os comentários.</div>`;
    return;
  }

  const comentarios = data || [];
  if (!comentarios.length) {
    lista.innerHTML = htmlEstadoVazio('Nenhum comentário ainda. Seja a primeira a comentar.');
    return;
  }

  const idsAutores = [...new Set(comentarios.map((c) => c.user_id))];
  const autores = {};
  const { data: perfis } = await supabase
    .from('profiles')
    .select('id,full_name,avatar_url')
    .in('id', idsAutores);
  (perfis || []).forEach((p) => { autores[p.id] = p; });

  lista.innerHTML = comentarios.map((c) => {
    const autor = autores[c.user_id];
    const nome = autor?.full_name || 'Alguém da comunidade';
    const avatar = autor?.avatar_url
      ? `<img src="${escapar(autor.avatar_url)}" alt="">`
      : icone('perfil', 16);
    return `
      <div class="comentario">
        <div class="comentario__avatar">${avatar}</div>
        <div class="comentario__corpo">
          <div class="comentario__linha">
            <span class="comentario__nome">${escapar(nome)}</span>
            <span class="comentario__hora">${escapar(formatarDataHora(c.created_at))}</span>
          </div>
          <p class="comentario__texto">${escapar(c.content)}</p>
        </div>
      </div>`;
  }).join('');
  lista.scrollTop = lista.scrollHeight;
}

/** Atualiza o número mostrado no botão "comentar" do post no feed, sem
    precisar recarregar o feed inteiro. */
function atualizarContadorDeComentarios(postId, delta) {
  const botao = document.querySelector(`.post-card__comentar[data-post-id="${postId}"]`);
  if (!botao) return;
  const contador = botao.querySelector('span');
  contador.textContent = String(Math.max((Number(contador.textContent) || 0) + delta, 0));
}

export function prepararComentarios() {
  const form = document.getElementById('form-comentario');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!postIdComentarios) return;

    const texto = form.texto.value.trim();
    if (!texto) return;

    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) return;

    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;

    const { error } = await supabase
      .from('post_comments')
      .insert({ post_id: postIdComentarios, user_id: user.id, content: texto });

    botao.disabled = false;

    if (error) {
      toast('Não foi possível enviar o comentário agora. Tente de novo.', 'erro');
      return;
    }

    form.reset();
    atualizarContadorDeComentarios(postIdComentarios, 1);
    await carregarComentarios(postIdComentarios);
  });

  document.getElementById('modal-comentarios')
    ?.querySelectorAll('[data-fechar]')
    .forEach((botao) => botao.addEventListener('click', () => { postIdComentarios = null; }));
}

export function prepararFiltrosDeComunidade() {
  const pills = document.querySelectorAll('.filtro-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      pills.forEach((p) => p.setAttribute('aria-pressed', 'false'));
      pill.setAttribute('aria-pressed', 'true');
      carregarFeed(pill.dataset.categoria || null);
    });
  });
}

/** Recarrega o feed sozinho quando qualquer publicação nova entra no banco —
    mesmo padrão que map.js já usa para relatos (ligarRealtimeRelatos). */
export function ligarRealtimePosts() {
  supabase
    .channel('posts-comunidade')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => {
      carregarFeed(filtroAtual);
    })
    .subscribe();
}

/* ========================================================================== */
/* 2. FORMULÁRIO "CADASTRAR PUBLICAÇÃO"                                       */
/* Reaproveitado tanto pelo botão "+" da Tela 1 (mapa.html) quanto da Tela 3  */
/* (alertas.html) — o modal #modal-publicacao existe em ambas as páginas.    */
/* ========================================================================== */

export function seletorDeLocalDaPublicacao() { return seletorPublicacao; }

/**
 * @param {object} opcoes
 * @param {() => void} [opcoes.aoPublicar] - chamado após publicar com sucesso
 *   (na Tela 3, recarrega o feed na hora; na Tela 1, não existe feed pra
 *   recarregar, então esse parâmetro fica de fora).
 */
export function prepararFormularioPublicacao({ aoPublicar } = {}) {
  const form = document.getElementById('form-publicacao');
  if (!form) return;
  const msg = document.getElementById('mensagem-publicacao');

  seletorPublicacao = criarSeletorLocal({
    mapa: 'publicacao-mini-mapa',
    busca: 'publicacao-busca-local',
    sugestoes: 'publicacao-sugestoes',
    resumo: 'publicacao-local-escolhido',
    botaoGps: 'publicacao-usar-localizacao'
  });

  // Localização é OPCIONAL aqui (diferente do relato/ponto de apoio): só
  // pedimos GPS/mostramos o mini-mapa quando a pessoa abre esta seção —
  // nunca automaticamente ao abrir o formulário.
  const detalhesLocal = document.getElementById('publicacao-local-detalhes');
  let localIniciado = false;
  detalhesLocal?.addEventListener('toggle', () => {
    if (detalhesLocal.open && !localIniciado) {
      localIniciado = true;
      seletorPublicacao.aoExibir();
    }
  });

  // Fechar o modal (X, clicar fora, Esc) sem publicar também limpa o
  // formulário — senão, reabrir mostraria o rascunho anterior.
  document.getElementById('modal-publicacao')
    ?.querySelectorAll('[data-fechar]')
    .forEach((botao) => {
      botao.addEventListener('click', () => {
        form.reset();
        limparMensagem(msg);
        seletorPublicacao?.limpar();
        if (detalhesLocal) { detalhesLocal.open = false; localIniciado = false; }
      });
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    if (!form.categoria.value) {
      return mostrarMensagem(msg, 'Escolha uma categoria.', 'atencao');
    }
    if (!form.titulo.value.trim()) {
      return mostrarMensagem(msg, 'Escreva um título.', 'atencao');
    }
    if (!form.conteudo.value.trim()) {
      return mostrarMensagem(msg, 'Escreva o texto da publicação.', 'atencao');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Publicando...');

    try {
      const { data: sessao } = await supabase.auth.getUser();
      const user = sessao?.user;
      if (!user) throw new Error('session');

      let imageUrl = null;
      const arquivo = form.imagem.files?.[0];
      if (arquivo) {
        if (arquivo.size > 5 * 1024 * 1024) {
          throw new Error('A imagem precisa ter no máximo 5 MB.');
        }
        const extensao = arquivo.name.split('.').pop().toLowerCase();
        const caminho = `${user.id}/publicacoes/${crypto.randomUUID()}.${extensao}`;
        const { error: erroUpload } = await supabase.storage
          .from('rota-segura')
          .upload(caminho, arquivo, { cacheControl: '3600', upsert: false });
        if (erroUpload) throw erroUpload;
        imageUrl = supabase.storage.from('rota-segura').getPublicUrl(caminho).data.publicUrl;
      }

      const local = seletorPublicacao.valor();

      const { error } = await supabase.from('posts').insert({
        user_id: user.id,
        category: form.categoria.value,
        title: form.titulo.value.trim(),
        content: form.conteudo.value.trim(),
        address: local?.nome || null,
        lat: local?.lat ?? null,
        lng: local?.lng ?? null,
        image_url: imageUrl,
        is_anonymous: form.anonimo?.checked || false
      });
      if (error) throw error;

      toast('Publicação enviada.', 'sucesso');
      form.reset();
      seletorPublicacao.limpar();
      if (detalhesLocal) { detalhesLocal.open = false; localIniciado = false; }
      fecharModal('modal-publicacao');

      aoPublicar?.();
    } catch (erro) {
      console.error(erro);
      const texto = erro.message?.includes('5 MB') ? erro.message : traduzirErro(erro);
      mostrarMensagem(msg, texto, 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}
