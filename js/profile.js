/* ============================================================================
   ROTA SEGURA — Perfil (Bloco 3)
   Dados reais do Supabase: perfil editável, avatar (Storage), meus relatos,
   minhas publicações, histórico de rotas e CRUD de contatos de emergência.
   Contatos de emergência e Configurações vivem aqui dentro (seções da mesma
   página), no mesmo espírito de relato/ponto de apoio: seção dentro de uma
   tela existente, não uma página nova por formulário.
   ============================================================================ */

import { exigirLogin, iniciarAuth, usuarioAtual } from './auth.js';
import { aplicarIcones, icone } from './icons.js';
import { supabase, traduzirErro } from './supabase.js';
import {
  prepararModais, prepararTrocaDeModal, prepararLightboxDeFotos, abrirModal, fecharModal, toast, escapar, formatarDataHora,
  botaoCarregando, htmlEstadoVazio, htmlCarregando, mostrarMensagem, limparMensagem
} from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
import { ROTULOS_PONTO, ROTULOS_RELATO } from './map.js';

const ROTULOS_CATEGORIA = { alerta: 'Alerta', dica: 'Dica', apoio: 'Apoio', noticia: 'Notícia' };

function formatarData(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatarDistancia(metros) {
  if (metros == null) return '';
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`;
}

/* ========================================================================== */
/* 1. CARTÃO DE PERFIL + EDIÇÃO                                               */
/* ========================================================================== */

async function carregarPerfil() {
  const user = await usuarioAtual();
  if (!user) return;

  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('full_name,phone,avatar_url,created_at')
    .eq('id', user.id)
    .single();

  // A linha de profiles é criada sozinha no cadastro (gatilho handle_new_user
  // do sql/schema.sql), então isto não deveria acontecer — mas, se por algum
  // motivo a linha ainda não existir, usar os dados da sessão em vez de
  // simplesmente sair em branco evita a tela ficar travada mostrando "..." e
  // o formulário de edição vazio sem explicação nenhuma.
  const dados = (!error && perfil) ? perfil : {
    full_name: user.user_metadata?.full_name || '',
    phone: null,
    avatar_url: null,
    created_at: null
  };

  document.getElementById('perfil-nome').textContent = dados.full_name || user.email;
  document.getElementById('perfil-email').textContent = user.email;
  document.getElementById('perfil-telefone').textContent = dados.phone || 'Telefone não informado';
  document.getElementById('perfil-desde').textContent = dados.created_at
    ? `Na plataforma desde ${formatarData(dados.created_at)}`
    : '';

  const avatarEl = document.getElementById('perfil-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = dados.avatar_url
      ? `<img src="${escapar(dados.avatar_url)}" alt="">`
      : icone('perfil', 32);
  }

  const form = document.getElementById('form-editar-perfil');
  if (form) {
    form.nome.value = dados.full_name || '';
    form.telefone.value = dados.phone || '';
  }

  document.getElementById('nome-usuaria').textContent = dados.full_name || user.email;
}

function prepararEdicaoPerfil() {
  const form = document.getElementById('form-editar-perfil');
  if (!form) return;
  const msg = document.getElementById('mensagem-perfil');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    const nome = form.nome.value.trim();
    if (nome.length < 3) {
      return mostrarMensagem(msg, 'Digite seu nome completo.', 'atencao');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');

    try {
      const user = await usuarioAtual();
      if (!user) throw new Error('session');

      let avatarUrl;
      const arquivo = form.avatar.files?.[0];
      if (arquivo) {
        if (arquivo.size > 5 * 1024 * 1024) {
          throw new Error('A imagem precisa ter no máximo 5 MB.');
        }
        const extensao = arquivo.name.split('.').pop().toLowerCase();
        const caminho = `${user.id}/avatar/${crypto.randomUUID()}.${extensao}`;
        const { error: erroUpload } = await supabase.storage
          .from('rota-segura')
          .upload(caminho, arquivo, { cacheControl: '3600', upsert: false });
        if (erroUpload) throw erroUpload;
        avatarUrl = supabase.storage.from('rota-segura').getPublicUrl(caminho).data.publicUrl;
      }

      const atualizacoes = { full_name: nome, phone: form.telefone.value.trim() || null };
      if (avatarUrl) atualizacoes.avatar_url = avatarUrl;

      // upsert (não update): a linha de profiles deveria sempre existir (o
      // gatilho do cadastro cria ela), mas um "UPDATE ... WHERE id = X" sem
      // nenhuma linha correspondente não dá erro nenhum no Postgres — só não
      // muda nada. Isso fazia o formulário mostrar "Perfil atualizado" sem
      // ter salvado de verdade, exatamente o bug relatado. upsert garante
      // que a linha é criada se, por qualquer motivo, ainda não existir.
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, ...atualizacoes });
      if (error) throw error;

      toast('Perfil atualizado.', 'sucesso');
      form.avatar.value = '';
      await carregarPerfil();
    } catch (erro) {
      console.error(erro);
      const texto = erro.message?.includes('5 MB') ? erro.message : traduzirErro(erro);
      mostrarMensagem(msg, texto, 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}

/* ========================================================================== */
/* 2. MEUS RELATOS / MINHAS PUBLICAÇÕES / HISTÓRICO DE ROTAS                  */
/* ========================================================================== */

let relatoParaExcluir = null;

async function carregarMeusRelatos() {
  const container = document.getElementById('perfil-relatos-lista');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const user = await usuarioAtual();
  if (!user) return;

  const { data, error } = await supabase
    .from('reports')
    .select('id,type,address,occurred_at,attention_level,status,image_url')
    .eq('user_id', user.id)
    .order('occurred_at', { ascending: false })
    .limit(10);

  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar seus relatos.</div>`;
    return;
  }

  const relatos = data || [];
  if (!relatos.length) {
    container.innerHTML = htmlEstadoVazio('Você ainda não registrou nenhum relato.');
    return;
  }

  container.innerHTML = relatos.map((r) => {
    const iluminacao = r.type === 'rua_pouco_iluminada';
    return `
      <article class="card-lista">
        <div class="card-lista__icone ${iluminacao ? 'card-lista__icone--atencao' : ''}">${icone(iluminacao ? 'lampada' : 'escudo', 20)}</div>
        <div class="card-lista__conteudo">
          <div class="card-lista__titulo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
          <div class="card-lista__meta">${escapar(formatarDataHora(r.occurred_at))}${r.status === 'pending' ? ' · Em análise' : ''}</div>
          <div class="card-lista__endereco">${escapar(r.address || 'Endereço não informado')}</div>
          ${r.image_url ? `
            <button type="button" class="card-lista__foto" data-ampliar-foto="${escapar(r.image_url)}">
              <img src="${escapar(r.image_url)}" alt="Foto anexada ao relato" loading="lazy">
            </button>` : ''}
        </div>
        <div class="contato-acoes">
          <button type="button" class="btn-icone" data-excluir-relato="${r.id}" aria-label="Excluir relato de ${escapar(formatarDataHora(r.occurred_at))}">${icone('lixeira', 16)}</button>
        </div>
      </article>`;
  }).join('');

  container.querySelectorAll('[data-excluir-relato]').forEach((b) => {
    b.addEventListener('click', () => {
      relatoParaExcluir = b.dataset.excluirRelato;
      abrirModal('modal-excluir-relato');
    });
  });
}

function prepararMeusRelatos() {
  document.getElementById('btn-confirmar-excluir-relato')?.addEventListener('click', async () => {
    if (!relatoParaExcluir) return;
    const { error } = await supabase.from('reports').delete().eq('id', relatoParaExcluir);
    fecharModal('modal-excluir-relato');
    if (error) { toast('Não foi possível excluir o relato.', 'erro'); return; }
    toast('Relato excluído.', 'sucesso');
    relatoParaExcluir = null;
    await carregarMeusRelatos();
  });
}

let pontosCache = [];
let pontoParaExcluir = null;

async function carregarMeusPontos() {
  const container = document.getElementById('perfil-pontos-lista');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const user = await usuarioAtual();
  if (!user) return;

  const { data, error } = await supabase
    .from('support_points')
    .select('id,type,name,address')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar seus pontos de apoio.</div>`;
    return;
  }

  pontosCache = data || [];
  if (!pontosCache.length) {
    container.innerHTML = htmlEstadoVazio('Você ainda não cadastrou nenhum ponto de apoio.');
    return;
  }

  container.innerHTML = pontosCache.map((p) => `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--verde">${icone('escudo', 20)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(p.name)}</div>
        <div class="card-lista__meta">${escapar(ROTULOS_PONTO[p.type] || 'Ponto de apoio')}</div>
        ${p.address ? `<div class="card-lista__endereco">${escapar(p.address)}</div>` : ''}
      </div>
      <div class="contato-acoes">
        <button type="button" class="btn-icone" data-excluir-ponto="${p.id}" aria-label="Excluir ${escapar(p.name)}">${icone('lixeira', 16)}</button>
      </div>
    </article>`).join('');

  container.querySelectorAll('[data-excluir-ponto]').forEach((b) => {
    b.addEventListener('click', () => {
      pontoParaExcluir = b.dataset.excluirPonto;
      abrirModal('modal-excluir-ponto');
    });
  });
}

function prepararMeusPontos() {
  document.getElementById('btn-confirmar-excluir-ponto')?.addEventListener('click', async () => {
    if (!pontoParaExcluir) return;
    const { error } = await supabase.from('support_points').delete().eq('id', pontoParaExcluir);
    fecharModal('modal-excluir-ponto');
    if (error) { toast('Não foi possível excluir o ponto de apoio.', 'erro'); return; }
    toast('Ponto de apoio excluído.', 'sucesso');
    pontoParaExcluir = null;
    await carregarMeusPontos();
  });
}

async function carregarMinhasPublicacoes() {
  const container = document.getElementById('perfil-publicacoes-lista');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const user = await usuarioAtual();
  if (!user) return;

  const { data, error } = await supabase
    .from('posts')
    .select('id,category,title,likes_count,created_at,is_anonymous')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar suas publicações.</div>`;
    return;
  }

  const posts = data || [];
  if (!posts.length) {
    container.innerHTML = htmlEstadoVazio('Você ainda não publicou nada na comunidade.');
    return;
  }

  container.innerHTML = posts.map((p) => `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--roxo">${icone('megafone', 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(p.title || 'Sem título')}</div>
        <div class="card-lista__meta">
          ${escapar(formatarDataHora(p.created_at))} · ${p.likes_count} curtida${p.likes_count === 1 ? '' : 's'}
          ${p.is_anonymous ? ' · publicada anonimamente' : ''}
        </div>
      </div>
      <span class="tag tag--rosa">${escapar(ROTULOS_CATEGORIA[p.category] || '')}</span>
      <div class="contato-acoes">
        <button type="button" class="btn-icone" data-excluir-publicacao="${p.id}" aria-label="Excluir publicação ${escapar(p.title || 'sem título')}">${icone('lixeira', 16)}</button>
      </div>
    </article>`).join('');

  container.querySelectorAll('[data-excluir-publicacao]').forEach((b) => {
    b.addEventListener('click', () => {
      publicacaoParaExcluir = b.dataset.excluirPublicacao;
      abrirModal('modal-excluir-publicacao');
    });
  });
}

let publicacaoParaExcluir = null;

function prepararMinhasPublicacoes() {
  document.getElementById('btn-confirmar-excluir-publicacao')?.addEventListener('click', async () => {
    if (!publicacaoParaExcluir) return;
    const { error } = await supabase.from('posts').delete().eq('id', publicacaoParaExcluir);
    fecharModal('modal-excluir-publicacao');
    if (error) { toast('Não foi possível excluir a publicação.', 'erro'); return; }
    toast('Publicação excluída.', 'sucesso');
    publicacaoParaExcluir = null;
    await carregarMinhasPublicacoes();
  });
}

async function carregarHistoricoRotas() {
  const container = document.getElementById('perfil-rotas-lista');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const user = await usuarioAtual();
  if (!user) return;

  const { data, error } = await supabase
    .from('route_history')
    .select('id,destination_address,distance_meters,duration_seconds,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar seu histórico de rotas.</div>`;
    return;
  }

  const rotas = data || [];
  if (!rotas.length) {
    container.innerHTML = htmlEstadoVazio('Nenhuma rota calculada ainda. Comece pela Tela de Rotas.');
    return;
  }

  container.innerHTML = rotas.map((r) => `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--verde">${icone('rotas', 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(r.destination_address || 'Destino não identificado')}</div>
        <div class="card-lista__meta">${escapar(formatarDataHora(r.created_at))} · ${formatarDistancia(r.distance_meters)}</div>
      </div>
    </article>`).join('');
}

function prepararHistoricoRotas() {
  document.getElementById('perfil-limpar-rotas')?.addEventListener('click', () => {
    abrirModal('modal-limpar-rotas');
  });

  document.getElementById('btn-confirmar-limpar-rotas')?.addEventListener('click', async () => {
    const botao = document.getElementById('btn-confirmar-limpar-rotas');
    const user = await usuarioAtual();
    if (!user) return;

    botaoCarregando(botao, true, 'Limpando...');
    // RLS de route_history ("rotas_proprias_delete") só deixa apagar as
    // próprias linhas mesmo sem o .eq('user_id', ...) aqui — mas escrevemos
    // explícito de qualquer forma, pelo mesmo motivo de sempre: nunca contar
    // só com o RLS pra dizer o que a query faz.
    const { error } = await supabase.from('route_history').delete().eq('user_id', user.id);
    botaoCarregando(botao, false);
    fecharModal('modal-limpar-rotas');

    if (error) { toast('Não foi possível limpar o histórico agora.', 'erro'); return; }
    toast('Histórico de rotas limpo.', 'sucesso');
    await carregarHistoricoRotas();
  });
}

/* ========================================================================== */
/* 3. CONTATOS DE EMERGÊNCIA                                                  */
/* ========================================================================== */

let contatosCache = [];
let contatoEditando = null;
let contatoParaExcluir = null;

function prepararContatos() {
  document.getElementById('perfil-novo-contato')?.addEventListener('click', () => {
    contatoEditando = null;
    document.getElementById('titulo-modal-contato').textContent = 'Adicionar contato de emergência';
    document.getElementById('form-contato').reset();
    limparMensagem(document.getElementById('mensagem-contato'));
    abrirModal('modal-contato');
  });

  document.getElementById('form-contato')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('mensagem-contato');
    limparMensagem(msg);

    const nome = form.nome.value.trim();
    const telefone = form.telefone.value.trim();
    if (!nome) return mostrarMensagem(msg, 'Digite o nome do contato.', 'atencao');
    if (!telefone) return mostrarMensagem(msg, 'Digite o telefone do contato.', 'atencao');

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');

    try {
      const user = await usuarioAtual();
      if (!user) throw new Error('session');

      const dadosContato = {
        name: nome,
        phone: telefone,
        relationship: form.relacionamento.value.trim() || null,
        is_primary: form.principal.checked
      };

      const { error } = contatoEditando
        ? await supabase.from('emergency_contacts').update(dadosContato).eq('id', contatoEditando)
        : await supabase.from('emergency_contacts').insert({ ...dadosContato, user_id: user.id });
      if (error) throw error;

      toast(contatoEditando ? 'Contato atualizado.' : 'Contato adicionado.', 'sucesso');
      fecharModal('modal-contato');
      await carregarContatos();
    } catch (erro) {
      mostrarMensagem(msg, traduzirErro(erro), 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });

  document.getElementById('btn-confirmar-excluir-contato')?.addEventListener('click', async () => {
    if (!contatoParaExcluir) return;
    const { error } = await supabase.from('emergency_contacts').delete().eq('id', contatoParaExcluir);
    fecharModal('modal-excluir-contato');
    if (error) { toast('Não foi possível excluir o contato.', 'erro'); return; }
    toast('Contato excluído.', 'sucesso');
    contatoParaExcluir = null;
    await carregarContatos();
  });
}

async function carregarContatos() {
  const container = document.getElementById('perfil-contatos-lista');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('id,name,phone,relationship,is_primary')
    .order('is_primary', { ascending: false })
    .order('created_at');

  if (error) {
    container.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar seus contatos.</div>`;
    return;
  }

  contatosCache = data || [];
  renderizarContatos(container, contatosCache);
}

function renderizarContatos(container, dados) {
  if (!dados.length) {
    container.innerHTML = htmlEstadoVazio(
      'Nenhum contato de emergência cadastrado. O botão SOS da Tela de Rotas precisa de pelo menos um.'
    );
    return;
  }

  container.innerHTML = dados.map((c) => `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--verde">${icone('telefone', 20)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">
          ${escapar(c.name)}${c.is_primary ? ' <span class="tag tag--rosa">Principal</span>' : ''}
        </div>
        <div class="card-lista__meta">${escapar(c.relationship || 'Sem relação informada')}</div>
        <div class="card-lista__endereco">${escapar(c.phone)}</div>
      </div>
      <div class="contato-acoes">
        <button type="button" class="btn-icone" data-editar="${c.id}" aria-label="Editar contato ${escapar(c.name)}">${icone('editar', 16)}</button>
        <button type="button" class="btn-icone" data-excluir="${c.id}" aria-label="Excluir contato ${escapar(c.name)}">${icone('lixeira', 16)}</button>
      </div>
    </article>`).join('');

  container.querySelectorAll('[data-editar]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = contatosCache.find((x) => x.id === b.dataset.editar);
      if (!c) return;
      contatoEditando = c.id;
      document.getElementById('titulo-modal-contato').textContent = 'Editar contato de emergência';
      const form = document.getElementById('form-contato');
      form.nome.value = c.name;
      form.telefone.value = c.phone;
      form.relacionamento.value = c.relationship || '';
      form.principal.checked = c.is_primary;
      limparMensagem(document.getElementById('mensagem-contato'));
      abrirModal('modal-contato');
    });
  });

  container.querySelectorAll('[data-excluir]').forEach((b) => {
    b.addEventListener('click', () => {
      contatoParaExcluir = b.dataset.excluir;
      abrirModal('modal-excluir-contato');
    });
  });
}

/* ========================================================================== */
/* 4. CONFIGURAÇÕES — trocar senha (única ação real desta seção)             */
/* ========================================================================== */

function prepararTrocaDeSenha() {
  const form = document.getElementById('form-trocar-senha');
  if (!form) return;
  const msg = document.getElementById('mensagem-senha');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    const senha = form.novaSenha.value;
    const confirmar = form.confirmarSenha.value;
    if (senha.length < 6) {
      return mostrarMensagem(msg, 'A senha precisa ter pelo menos 6 caracteres.', 'atencao');
    }
    if (senha !== confirmar) {
      return mostrarMensagem(msg, 'As senhas não são iguais.', 'atencao');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');

    const { error } = await supabase.auth.updateUser({ password: senha });

    botaoCarregando(botao, false);

    if (error) {
      mostrarMensagem(msg, traduzirErro(error), 'erro');
      return;
    }
    form.reset();
    mostrarMensagem(msg, 'Senha alterada com sucesso.', 'sucesso');
  });
}

/* ========================================================================== */
/* 5. INICIALIZAÇÃO                                                          */
/* ========================================================================== */

async function iniciar() {
  aplicarIcones();
  const usuario = await exigirLogin();
  if (!usuario) return;

  iniciarAuth();
  prepararModais();
  prepararTrocaDeModal();
  prepararLightboxDeFotos();
  marcarItemAtivo();
  prepararNotificacoes();

  document.getElementById('botao-central')?.addEventListener('click', () => {
    toast('Para cadastrar, volte à tela do Mapa.', 'info');
    window.location.href = 'mapa.html';
  });

  await carregarPerfil();
  prepararEdicaoPerfil();
  prepararTrocaDeSenha();
  prepararContatos();
  prepararMeusPontos();
  prepararMeusRelatos();
  prepararMinhasPublicacoes();
  prepararHistoricoRotas();

  await Promise.all([
    carregarMeusRelatos(),
    carregarMeusPontos(),
    carregarMinhasPublicacoes(),
    carregarHistoricoRotas(),
    carregarContatos(),
    atualizarBadgeNotificacoes()
  ]);
  ligarRealtimeBadgeNotificacoes();
}

document.addEventListener('DOMContentLoaded', iniciar);
