/* ============================================================
   ROTA SEGURA — app.js
   Orquestra a UI: autenticação, mapa, locais, comunidade e o
   botão de emergência. Os módulos fazem o trabalho pesado; este
   arquivo só liga tudo aos elementos da tela.
   ============================================================ */

import { supabaseConfigurado } from './supabaseClient.js';
import * as Auth from './auth.js';
import * as DB from './database.js';
import * as Mapa from './map.js';
import * as Comunidade from './community.js';
import { obterLinkDeEmergencia } from './emergency.js';

// Se este número não aparecer no console (F12) quando você abrir o
// site, o navegador está te mostrando uma versão antiga em cache —
// force um recarregamento completo (Ctrl+Shift+R) ou abra em uma
// aba anônima para confirmar.
console.log('[Rota Segura] app.js versão 4 carregado');

/* ---------------------------------------------------------- */
/* Estado                                                       */
/* ---------------------------------------------------------- */
const estado = {
  usuario: null,
  perfil: null,
  locais: [],
  categoriaAtual: 'todos',
  buscaAtual: '',
  canalComunidade: null,
  canalLocais: null
};

const CATEGORIA_LABEL = { rua: 'Rua/Praça', estabelecimento: 'Estabelecimento', onibus: 'Ponto de ônibus', estacao: 'Estação' };
const NIVEL_LABEL = { seguro: 'Seguro', atencao: 'Pouco iluminado', alerta: 'Isolado / Alerta' };

/* ---------------------------------------------------------- */
/* Referências DOM                                              */
/* ---------------------------------------------------------- */
const el = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', iniciar);

async function iniciar() {
  if (!supabaseConfigurado) {
    mostrarToast('As chaves do Supabase não foram configuradas em js/config.js. Veja o README.', 'erro', 8000);
  }

  registrarEventosAuth();
  registrarEventosApp();

  const usuario = await Auth.obterUsuarioValidado();
  if (usuario) {
    await entrarNoApp(usuario);
  } else {
    mostrarTelaAuth();
  }

  Auth.aoMudarAutenticacao(async (evento, sessao) => {
    if (evento === 'SIGNED_OUT') mostrarTelaAuth();
  });
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
function registrarEventosAuth() {
  el('authTabLogin').addEventListener('click', () => alternarAbaAuth('login'));
  el('authTabCadastro').addEventListener('click', () => alternarAbaAuth('cadastro'));

  el('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('loginEmail').value.trim();
    const senha = el('loginSenha').value;
    try {
      definirCarregando('formLogin', true);
      const { user } = await Auth.entrar({ email, senha });
      await entrarNoApp(user);
    } catch (err) {
      mostrarToast(traduzirErroAuth(err), 'erro');
    } finally {
      definirCarregando('formLogin', false);
    }
  });

  el('formCadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = el('cadastroNome').value.trim();
    const email = el('cadastroEmail').value.trim();
    const senha = el('cadastroSenha').value;
    const contatoEmergencia = el('cadastroContato').value.trim();

    if (senha.length < 6) {
      mostrarToast('A senha precisa ter pelo menos 6 caracteres.', 'erro');
      return;
    }
    if (contatoEmergencia.replace(/\D/g, '').length < 10) {
      mostrarToast('Informe um telefone de emergência válido, com DDD.', 'erro');
      return;
    }

    try {
      definirCarregando('formCadastro', true);
      const { user, session } = await Auth.cadastrar({ nome, email, senha, contatoEmergencia });
      if (session) {
        await entrarNoApp(user);
      } else {
        mostrarToast('Conta criada! Confirme seu e-mail e depois faça login.', 'sucesso', 6000);
        alternarAbaAuth('login');
      }
    } catch (err) {
      mostrarToast(traduzirErroAuth(err), 'erro');
    } finally {
      definirCarregando('formCadastro', false);
    }
  });
}

function alternarAbaAuth(aba) {
  el('authTabLogin').classList.toggle('active', aba === 'login');
  el('authTabCadastro').classList.toggle('active', aba === 'cadastro');
  el('formLogin').hidden = aba !== 'login';
  el('formCadastro').hidden = aba !== 'cadastro';
}

function traduzirErroAuth(err) {
  const msg = err?.message || '';
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('already registered')) return 'Já existe uma conta com este e-mail.';
  if (msg.includes('Password should be')) return 'A senha é muito curta.';
  return msg || 'Algo deu errado. Tente novamente.';
}

async function entrarNoApp(usuario) {
  estado.usuario = usuario;
  try {
    estado.perfil = await Auth.obterPerfil(usuario.id);
  } catch {
    estado.perfil = null;
  }

  el('telaAuth').hidden = true;
  el('appRoot').hidden = false;
  el('nomeUsuaria').textContent = estado.perfil?.nome || usuario.email;

  // Reset defensivo: garante que nenhum modal de uma sessão
  // anterior (ex: ainda aberto antes de logout/nova conta) fique
  // empilhado por cima da tela do app.
  fecharTodosOsModais();

  Mapa.inicializarMapa('mapaContainer');
  await carregarLocais();
  ativarRealtimeLocais();

  if (el('tabComunidade').classList.contains('active')) {
    await carregarComunidade();
  }
}

async function sairDoApp() {
  await Auth.sair();
  estado.usuario = null;
  estado.perfil = null;
  if (estado.canalComunidade) Comunidade.cancelarInscricao(estado.canalComunidade);
  fecharTodosOsModais();
  mostrarTelaAuth();
}

function mostrarTelaAuth() {
  fecharTodosOsModais();
  el('telaAuth').hidden = false;
  el('appRoot').hidden = true;
}

/* ============================================================
   NAVEGAÇÃO ENTRE ABAS DO APP
   ============================================================ */
function registrarEventosApp() {
  el('btnSair').addEventListener('click', sairDoApp);
  el('btnMeuPerfil').addEventListener('click', abrirModalPerfil);

  el('navBtnMapa').addEventListener('click', () => alternarAbaApp('mapa'));
  el('navBtnComunidade').addEventListener('click', () => alternarAbaApp('comunidade'));

  document.querySelectorAll('.categoria-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.categoria-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.categoriaAtual = btn.dataset.categoria;
      renderizarLocais();
    });
  });

  el('campoBusca').addEventListener('input', (e) => {
    estado.buscaAtual = e.target.value.toLowerCase();
    renderizarLocais();
  });

  // Modal cadastro de local
  el('btnCadastrarLocal').addEventListener('click', abrirModalLocal);
  el('fecharModalLocal').addEventListener('click', fecharModalLocal);
  el('btnEscolherNoMapa').addEventListener('click', ativarEscolhaNoMapa);
  el('formLocal').addEventListener('submit', enviarFormLocal);

  // Modal perfil
  el('fecharModalPerfil').addEventListener('click', () => (el('modalPerfil').hidden = true));

  // Comunidade
  el('formPost').addEventListener('submit', enviarPost);

  // Emergência
  el('btnEmergencia').addEventListener('click', acionarEmergencia);

  // Fecha modais clicando fora
  [el('modalLocal'), el('modalPerfil')].forEach((modal) => {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  });

  // Tecla Esc fecha qualquer modal aberto
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharTodosOsModais();
  });
}

/** Garante que só um modal fica aberto por vez. */
function fecharTodosOsModais() {
  el('modalLocal').hidden = true;
  el('modalPerfil').hidden = true;
  Mapa.desativarEscolhaDeLocal();
  Mapa.limparMarcadorTemporario();
}

async function alternarAbaApp(aba) {
  el('navBtnMapa').classList.toggle('active', aba === 'mapa');
  el('navBtnComunidade').classList.toggle('active', aba === 'comunidade');
  el('tabMapa').classList.toggle('active', aba === 'mapa');
  el('tabComunidade').classList.toggle('active', aba === 'comunidade');
  el('tabMapa').hidden = aba !== 'mapa';
  el('tabComunidade').hidden = aba !== 'comunidade';

  if (aba === 'mapa') {
    Mapa.invalidarTamanhoDoMapa();
  } else {
    await carregarComunidade();
    ativarRealtimeComunidade();
  }
}

/* ============================================================
   LOCAIS / MAPA
   ============================================================ */
async function carregarLocais() {
  try {
    const { recentes } = await DB.buscarLocaisRecentes();
    estado.locais = recentes;
    renderizarLocais();
  } catch (err) {
    mostrarToast('Não foi possível carregar os locais. ' + (err.message || ''), 'erro');
  }
}

function locaisFiltrados() {
  return estado.locais.filter((local) => {
    const combinaCategoria = estado.categoriaAtual === 'todos' || local.categoria === estado.categoriaAtual;
    const combinaBusca =
      !estado.buscaAtual ||
      local.nome.toLowerCase().includes(estado.buscaAtual) ||
      local.bairro.toLowerCase().includes(estado.buscaAtual);
    return combinaCategoria && combinaBusca;
  });
}

function renderizarLocais() {
  const filtrados = locaisFiltrados();

  Mapa.renderizarMarcadores(filtrados, {
    onSelecionar: (local) => Mapa.centralizarEm(local.latitude, local.longitude)
  });

  const grid = el('gridLocais');
  el('contagemLocais').textContent =
    filtrados.length === 0 ? 'Nenhum local encontrado' : `${filtrados.length} local(is) encontrados`;

  if (filtrados.length === 0) {
    grid.innerHTML = `<p class="estado-vazio">Nenhum local por aqui ainda. Que tal ser a primeira a cadastrar?</p>`;
    return;
  }

  grid.innerHTML = filtrados
    .map(
      (local) => `
      <article class="card-local nivel-${local.nivel_seguranca}" data-id="${local.id}">
        <div class="card-local-topo">
          <span class="badge-nivel badge-${local.nivel_seguranca}">${NIVEL_LABEL[local.nivel_seguranca]}</span>
          <span class="badge-categoria">${CATEGORIA_LABEL[local.categoria]}</span>
        </div>
        <h3>${escaparHtml(local.nome)}</h3>
        <p class="card-local-bairro">${escaparHtml(local.bairro)}</p>
        ${local.descricao ? `<p class="card-local-desc">${escaparHtml(local.descricao)}</p>` : ''}
        <p class="card-local-meta">Atualizado em ${formatarData(local.created_at)}${local.autor_nome ? ' por ' + escaparHtml(local.autor_nome) : ''}</p>
      </article>`
    )
    .join('');

  grid.querySelectorAll('.card-local').forEach((card) => {
    card.addEventListener('click', () => {
      const local = filtrados.find((l) => l.id === card.dataset.id);
      if (local) {
        alternarAbaApp('mapa');
        Mapa.centralizarEm(local.latitude, local.longitude, 16);
      }
    });
  });
}

function ativarRealtimeLocais() {
  if (estado.canalLocais) return;
  estado.canalLocais = DB.inscreverNovosLocais(() => carregarLocais());
}

/* --- Modal de cadastro de local --- */
let coordenadaEscolhida = null;

function abrirModalLocal() {
  fecharTodosOsModais();
  el('formLocal').reset();
  coordenadaEscolhida = null;
  el('coordSelecionada').textContent = 'Nenhum ponto escolhido ainda.';
  el('modalLocal').hidden = false;
}

function fecharModalLocal() {
  el('modalLocal').hidden = true;
  Mapa.desativarEscolhaDeLocal();
  Mapa.limparMarcadorTemporario();
}

function ativarEscolhaNoMapa() {
  el('modalLocal').hidden = true;
  alternarAbaApp('mapa');
  mostrarToast('Clique no mapa para marcar o local exato.', 'info', 4000);

  Mapa.ativarEscolhaDeLocal((latlng) => {
    coordenadaEscolhida = latlng;
    el('modalLocal').hidden = false;
    el('coordSelecionada').textContent = `Ponto marcado: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    Mapa.desativarEscolhaDeLocal();
  });
}

async function enviarFormLocal(e) {
  e.preventDefault();
  if (!coordenadaEscolhida) {
    mostrarToast('Escolha o ponto no mapa antes de salvar.', 'erro');
    return;
  }

  const dados = {
    nome: el('localNome').value.trim(),
    bairro: el('localBairro').value.trim(),
    categoria: el('localCategoria').value,
    nivelSeguranca: document.querySelector('input[name="nivelSeguranca"]:checked')?.value,
    descricao: el('localDescricao').value.trim(),
    latitude: coordenadaEscolhida.lat,
    longitude: coordenadaEscolhida.lng,
    autorId: estado.usuario.id,
    autorNome: estado.perfil?.nome || estado.usuario.email
  };

  if (!dados.nivelSeguranca) {
    mostrarToast('Selecione o nível de segurança do local.', 'erro');
    return;
  }

  try {
    definirCarregando('formLocal', true);
    await DB.criarLocal(dados);
    mostrarToast('Local cadastrado! Obrigada por contribuir. 💜', 'sucesso');
    fecharModalLocal();
    await carregarLocais();
  } catch (err) {
    mostrarToast('Não foi possível salvar o local. ' + (err.message || ''), 'erro');
  } finally {
    definirCarregando('formLocal', false);
  }
}

/* ============================================================
   COMUNIDADE
   ============================================================ */
async function carregarComunidade() {
  try {
    const posts = await Comunidade.buscarPosts();
    renderizarPosts(posts);
  } catch (err) {
    mostrarToast('Não foi possível carregar a comunidade. ' + (err.message || ''), 'erro');
  }
}

function renderizarPosts(posts) {
  const lista = el('listaPosts');
  if (posts.length === 0) {
    lista.innerHTML = `<p class="estado-vazio">Ainda não há mensagens. Comece a conversa com a comunidade.</p>`;
    return;
  }

  lista.innerHTML = posts
    .map(
      (post) => `
      <div class="post-item tipo-${post.tipo}">
        <div class="post-cabecalho">
          <strong>${escaparHtml(post.autor_nome)}</strong>
          <span class="badge-tipo">${rotuloTipoPost(post.tipo)}</span>
          <span class="post-data">${formatarData(post.created_at)}</span>
        </div>
        <p>${escaparHtml(post.conteudo)}</p>
      </div>`
    )
    .join('');

  lista.scrollTop = lista.scrollHeight;
}

function rotuloTipoPost(tipo) {
  return { relato: 'Relato', duvida: 'Dúvida', aviso: 'Aviso' }[tipo] || tipo;
}

function ativarRealtimeComunidade() {
  if (estado.canalComunidade) return;
  estado.canalComunidade = Comunidade.inscreverNovosPosts(async () => {
    const posts = await Comunidade.buscarPosts();
    renderizarPosts(posts);
  });
}

async function enviarPost(e) {
  e.preventDefault();
  const conteudo = el('postConteudo').value;
  const tipo = el('postTipo').value;

  try {
    definirCarregando('formPost', true);
    await Comunidade.publicarPost({
      autorId: estado.usuario.id,
      autorNome: estado.perfil?.nome || estado.usuario.email,
      conteudo,
      tipo
    });
    el('postConteudo').value = '';
    await carregarComunidade();
  } catch (err) {
    mostrarToast(err.message || 'Não foi possível publicar.', 'erro');
  } finally {
    definirCarregando('formPost', false);
  }
}

/* ============================================================
   PERFIL
   ============================================================ */
async function abrirModalPerfil() {
  fecharTodosOsModais();

  // Se o perfil ainda não foi carregado (ex: conta criada antes de
  // confirmar o e-mail), tenta buscar de novo antes de desistir.
  if (!estado.perfil && estado.usuario) {
    try {
      estado.perfil = await Auth.obterPerfil(estado.usuario.id);
    } catch { /* segue com estado.perfil == null */ }
  }

  if (!estado.perfil) {
    el('perfilNome').textContent = '—';
    el('perfilEmail').textContent = estado.usuario?.email || '—';
    el('perfilContato').textContent = '—';
    mostrarToast(
      'Não encontramos seu contato de emergência. Saia e crie a conta novamente para corrigir isso.',
      'erro', 7000
    );
  } else {
    el('perfilNome').textContent = estado.perfil.nome || '—';
    el('perfilEmail').textContent = estado.perfil.email || estado.usuario?.email || '—';
    el('perfilContato').textContent = estado.perfil.contato_emergencia || '—';
  }

  el('modalPerfil').hidden = false;
}

/* ============================================================
   BOTÃO DE EMERGÊNCIA
   ============================================================ */
async function acionarEmergencia() {
  const contato = estado.perfil?.contato_emergencia;
  const btn = el('btnEmergencia');
  btn.disabled = true;
  btn.classList.add('carregando');

  try {
    const { url } = await obterLinkDeEmergencia(contato);
    window.open(url, '_blank', 'noopener');
    mostrarToast('Localização pronta para envio no WhatsApp.', 'sucesso');
  } catch (err) {
    mostrarToast(err.message, 'erro', 7000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('carregando');
  }
}

/* ============================================================
   UTILITÁRIOS DE UI
   ============================================================ */
function definirCarregando(formId, carregando) {
  const form = el(formId);
  const botao = form.querySelector('button[type="submit"]');
  if (!botao) return;
  botao.disabled = carregando;
  botao.dataset.textoOriginal = botao.dataset.textoOriginal || botao.textContent;
  botao.textContent = carregando ? 'Enviando...' : botao.dataset.textoOriginal;
}

function mostrarToast(mensagem, tipo = 'info', duracao = 4500) {
  const container = el('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('visivel'), 10);
  setTimeout(() => {
    toast.classList.remove('visivel');
    setTimeout(() => toast.remove(), 300);
  }, duracao);
}

function formatarData(isoString) {
  const data = new Date(isoString);
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escaparHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}