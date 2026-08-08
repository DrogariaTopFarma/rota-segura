/* ============================================================
   ROTA SEGURA — app.js
   Orquestra a UI: autenticação, mapa (relatos + instituições +
   geocodificação), filtros, mural de avisos, validação
   comunitária, guia de segurança e barra SOS.
   ============================================================ */

import { supabaseConfigurado } from './supabaseClient.js';
import * as Auth from './auth.js';
import * as DB from './database.js';
import * as Mapa from './map.js';
import * as Comunidade from './community.js';
import * as Instituicoes from './institutions.js';
import * as Votos from './votes.js';
import { obterLinkDeEmergencia } from './emergency.js';
import { geocodificarEndereco, comDebounce } from './geocode.js';

console.log('[Rota Segura] app.js versão 5 carregado');

/* ---------------------------------------------------------- */
/* Estado                                                       */
/* ---------------------------------------------------------- */
const estado = {
  usuario: null,
  perfil: null,
  pontos: [],          // relatos agrupados por local (ver database.js)
  instituicoes: [],
  votosResumo: {},      // { [local_id]: { concordo, discordo, meuVoto } }
  filtroCategoria: 'todos',
  filtroPeriodo: 'todos',
  filtroCamada: 'todos', // todos | relatos | delegacia | apoio
  buscaAtual: '',
  canais: {}
};

const CATEGORIA_LABEL = { rua: 'Rua/Praça', estabelecimento: 'Estabelecimento', onibus: 'Ponto de ônibus', estacao: 'Estação' };
const NIVEL_LABEL = { seguro: 'Seguro', atencao: 'Pouco iluminado', alerta: 'Isolado / Alerta' };
const PERIODO_LABEL = { manha: '☀️ Manhã', tarde: '🌤️ Tarde', noite: '🌙 Noite', madrugada: '🌌 Madrugada' };

const el = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', iniciar);

async function iniciar() {
  if (!supabaseConfigurado) {
    mostrarToast('As chaves do Supabase não foram configuradas em js/config.js. Veja o README.', 'erro', 8000);
  }

  registrarEventosAuth();
  registrarEventosApp();
  registrarEventosCadastroLocal();
  registrarEventosCadastroInstituicao();

  const usuario = await Auth.obterUsuarioValidado();
  if (usuario) {
    await entrarNoApp(usuario);
  } else {
    mostrarTelaAuth();
  }

  Auth.aoMudarAutenticacao((evento) => {
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

  fecharTodosOsModais();

  Mapa.inicializarMapa('mapaContainer');
  await Promise.all([carregarLocais(), carregarInstituicoes()]);
  ativarRealtime();
}

async function sairDoApp() {
  await Auth.sair();
  estado.usuario = null;
  estado.perfil = null;
  Object.values(estado.canais).forEach((canal) => canal && Comunidade.cancelarInscricao(canal));
  estado.canais = {};
  fecharTodosOsModais();
  mostrarTelaAuth();
}

function mostrarTelaAuth() {
  fecharTodosOsModais();
  el('telaAuth').hidden = false;
  el('appRoot').hidden = true;
}

/* ============================================================
   NAVEGAÇÃO ENTRE ABAS
   ============================================================ */
function registrarEventosApp() {
  el('btnSair').addEventListener('click', sairDoApp);
  el('btnMeuPerfil').addEventListener('click', abrirModalPerfil);

  el('navBtnMapa').addEventListener('click', () => alternarAbaApp('mapa'));
  el('navBtnMural').addEventListener('click', () => alternarAbaApp('mural'));
  el('navBtnGuia').addEventListener('click', () => alternarAbaApp('guia'));

  document.querySelectorAll('.categoria-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.categoria-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.filtroCategoria = btn.dataset.categoria;
      renderizarLocais();
    });
  });

  document.querySelectorAll('.periodo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.periodo-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.filtroPeriodo = btn.dataset.periodo;
      renderizarLocais();
    });
  });

  document.querySelectorAll('.camada-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.camada-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      estado.filtroCamada = btn.dataset.camada;
      renderizarLocais();
    });
  });

  // Busca com resultados instantâneos (sem exigir rolagem)
  el('campoBusca').addEventListener('input', (e) => {
    estado.buscaAtual = e.target.value.toLowerCase().trim();
    renderizarResultadosBusca();
    renderizarLocais();
  });
  document.addEventListener('click', (e) => {
    if (!el('resultadosBusca').contains(e.target) && e.target !== el('campoBusca')) {
      el('resultadosBusca').hidden = true;
    }
  });

  // Modais
  el('btnCadastrarLocal').addEventListener('click', abrirModalLocal);
  el('fecharModalLocal').addEventListener('click', () => (el('modalLocal').hidden = true));

  el('btnCadastrarInstituicao').addEventListener('click', abrirModalInstituicao);
  el('fecharModalInstituicao').addEventListener('click', () => (el('modalInstituicao').hidden = true));

  el('fecharModalDetalhes').addEventListener('click', () => (el('modalDetalhes').hidden = true));
  el('fecharModalPerfil').addEventListener('click', () => (el('modalPerfil').hidden = true));

  // Mural de Avisos
  el('formPost').addEventListener('submit', enviarPost);

  // SOS
  el('btnSos').addEventListener('click', () => {
    el('sosMenu').hidden = !el('sosMenu').hidden;
  });
  el('btnEmergenciaWhatsApp').addEventListener('click', acionarEmergenciaWhatsApp);

  [el('modalLocal'), el('modalInstituicao'), el('modalDetalhes'), el('modalPerfil')].forEach((modal) => {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharTodosOsModais();
  });
}

function fecharTodosOsModais() {
  ['modalLocal', 'modalInstituicao', 'modalDetalhes', 'modalPerfil'].forEach((id) => (el(id).hidden = true));
  el('sosMenu').hidden = true;
}

async function alternarAbaApp(aba) {
  el('navBtnMapa').classList.toggle('active', aba === 'mapa');
  el('navBtnMural').classList.toggle('active', aba === 'mural');
  el('navBtnGuia').classList.toggle('active', aba === 'guia');
  el('tabMapa').hidden = aba !== 'mapa';
  el('tabMural').hidden = aba !== 'mural';
  el('tabGuia').hidden = aba !== 'guia';

  if (aba === 'mapa') {
    Mapa.invalidarTamanhoDoMapa();
  } else if (aba === 'mural') {
    await carregarMural();
    ativarRealtimeMural();
  }
}

/* ============================================================
   LOCAIS / RELATOS / MAPA
   ============================================================ */
async function carregarLocais() {
  try {
    estado.pontos = await DB.buscarPontosAgrupados();
    estado.votosResumo = await Votos.buscarResumoVotos(estado.usuario?.id);
    renderizarLocais();
  } catch (err) {
    mostrarToast('Não foi possível carregar os relatos. ' + (err.message || ''), 'erro');
  }
}

async function carregarInstituicoes() {
  try {
    estado.instituicoes = await Instituicoes.buscarInstituicoes();
    renderizarLocais();
  } catch (err) {
    mostrarToast('Não foi possível carregar delegacias/pontos de apoio. ' + (err.message || ''), 'erro');
  }
}

function calcularPontosFiltrados() {
  return estado.pontos
    .map((ponto) => {
      let relatos = ponto.relatos;
      if (estado.filtroPeriodo !== 'todos') relatos = relatos.filter((r) => r.periodo === estado.filtroPeriodo);
      if (!relatos.length) return null;
      return { localKey: ponto.localKey, relatos, representante: relatos[0], totalRelatos: relatos.length };
    })
    .filter(Boolean)
    .filter((ponto) => estado.filtroCategoria === 'todos' || ponto.representante.categoria === estado.filtroCategoria)
    .filter((ponto) => {
      if (!estado.buscaAtual) return true;
      return (
        ponto.representante.nome.toLowerCase().includes(estado.buscaAtual) ||
        ponto.representante.bairro.toLowerCase().includes(estado.buscaAtual)
      );
    });
}

function renderizarLocais() {
  const pontosFiltrados = calcularPontosFiltrados();

  const mostrarRelatos = estado.filtroCamada === 'todos' || estado.filtroCamada === 'relatos';
  const mostrarDelegacias = estado.filtroCamada === 'todos' || estado.filtroCamada === 'delegacia';
  const mostrarApoio = estado.filtroCamada === 'todos' || estado.filtroCamada === 'apoio';

  Mapa.renderizarPontos(mostrarRelatos ? pontosFiltrados : [], { onAbrirDetalhes: abrirModalDetalhes });

  const instFiltradas = estado.instituicoes.filter(
    (i) => (i.tipo === 'delegacia' && mostrarDelegacias) || (i.tipo === 'apoio' && mostrarApoio)
  );
  Mapa.renderizarInstituicoes(instFiltradas, {
    onSelecionar: (inst) => Mapa.centralizarEm(inst.latitude, inst.longitude, 16)
  });

  // Grade de relatos (independe da camada — é sempre sobre relatos)
  const grid = el('gridLocais');
  el('contagemLocais').textContent =
    pontosFiltrados.length === 0 ? 'Nenhum local encontrado' : `${pontosFiltrados.length} local(is) encontrados`;

  if (pontosFiltrados.length === 0) {
    grid.innerHTML = `<p class="estado-vazio">Nenhum relato por aqui ainda com esses filtros. Que tal ser a primeira a contribuir?</p>`;
    return;
  }

  grid.innerHTML = pontosFiltrados
    .map(({ representante, totalRelatos, localKey }) => `
      <article class="card-local nivel-${representante.nivel_seguranca}" data-key="${localKey}">
        <div class="card-local-topo">
          <span class="badge-nivel badge-${representante.nivel_seguranca}">${NIVEL_LABEL[representante.nivel_seguranca]}</span>
          <span class="badge-categoria">${CATEGORIA_LABEL[representante.categoria]}</span>
          ${totalRelatos > 1 ? `<span class="badge-categoria">${totalRelatos} relatos</span>` : ''}
        </div>
        <h3>${escaparHtml(representante.nome)}</h3>
        <p class="card-local-bairro">${escaparHtml(representante.bairro)}</p>
        ${representante.descricao ? `<p class="card-local-desc">${escaparHtml(representante.descricao)}</p>` : ''}
        <p class="card-local-meta">${PERIODO_LABEL[representante.periodo] || ''} · Atualizado em ${formatarData(representante.created_at)}</p>
      </article>`)
    .join('');

  grid.querySelectorAll('.card-local').forEach((card) => {
    card.addEventListener('click', () => {
      const ponto = pontosFiltrados.find((p) => p.localKey === card.dataset.key);
      if (ponto) {
        Mapa.centralizarEm(ponto.representante.latitude, ponto.representante.longitude, 16);
        abrirModalDetalhes(ponto);
      }
    });
  });
}

function renderizarResultadosBusca() {
  const painel = el('resultadosBusca');
  if (!estado.buscaAtual) {
    painel.hidden = true;
    painel.innerHTML = '';
    return;
  }

  const correspondentes = estado.pontos
    .filter(
      (p) =>
        p.representante.nome.toLowerCase().includes(estado.buscaAtual) ||
        p.representante.bairro.toLowerCase().includes(estado.buscaAtual)
    )
    .slice(0, 6);

  if (correspondentes.length === 0) {
    painel.innerHTML = `<div class="resultado-busca-item">Nenhum resultado encontrado.</div>`;
    painel.hidden = false;
    return;
  }

  painel.innerHTML = correspondentes
    .map(
      (p) => `
      <div class="resultado-busca-item" data-key="${p.localKey}">
        <span class="resultado-busca-nome">${escaparHtml(p.representante.nome)}</span>
        <span class="resultado-busca-bairro">${escaparHtml(p.representante.bairro)}</span>
      </div>`
    )
    .join('');

  painel.querySelectorAll('.resultado-busca-item[data-key]').forEach((item) => {
    item.addEventListener('click', () => {
      const ponto = estado.pontos.find((p) => p.localKey === item.dataset.key);
      painel.hidden = true;
      if (ponto) {
        alternarAbaApp('mapa');
        Mapa.centralizarEm(ponto.representante.latitude, ponto.representante.longitude, 17);
        abrirModalDetalhes(ponto);
      }
    });
  });

  painel.hidden = false;
}

function ativarRealtime() {
  if (!estado.canais.locais) {
    estado.canais.locais = DB.inscreverNovosLocais(() => carregarLocais());
  }
  if (!estado.canais.instituicoes) {
    estado.canais.instituicoes = Instituicoes.inscreverNovasInstituicoes(() => carregarInstituicoes());
  }
  if (!estado.canais.votos) {
    estado.canais.votos = Votos.inscreverNovosVotos(async () => {
      estado.votosResumo = await Votos.buscarResumoVotos(estado.usuario?.id);
      if (!el('modalDetalhes').hidden) reabrirDetalhesAtual();
    });
  }
}

/* ============================================================
   DETALHES DO PONTO (todos os relatos + validação comunitária)
   ============================================================ */
let pontoDetalheAtual = null;

function abrirModalDetalhes(ponto) {
  fecharTodosOsModais();
  pontoDetalheAtual = ponto;

  el('tituloModalDetalhes').textContent = ponto.representante.nome;
  el('detalhesSubtitulo').textContent =
    `${ponto.representante.bairro} · ${ponto.relatos.length} relato(s)`;

  renderizarListaDetalhes(ponto);
  el('modalDetalhes').hidden = false;
}

function reabrirDetalhesAtual() {
  if (!pontoDetalheAtual) return;
  const atualizado = estado.pontos.find((p) => p.localKey === pontoDetalheAtual.localKey);
  if (atualizado) {
    pontoDetalheAtual = atualizado;
    renderizarListaDetalhes(atualizado);
  }
}

function renderizarListaDetalhes(ponto) {
  const relatosOrdenados = [...ponto.relatos].sort((a, b) => {
    const scoreA = pontuacaoVoto(a.id);
    const scoreB = pontuacaoVoto(b.id);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  el('listaDetalhes').innerHTML = relatosOrdenados
    .map((relato) => {
      const resumo = estado.votosResumo[relato.id] || { concordo: 0, discordo: 0, meuVoto: null };
      const autor = relato.anonimo ? 'Anônima' : relato.autor_nome || 'Usuária';
      return `
      <div class="detalhe-item nivel-${relato.nivel_seguranca}" data-relato-id="${relato.id}">
        <div class="detalhe-cabecalho">
          <span class="badge-nivel badge-${relato.nivel_seguranca}">${NIVEL_LABEL[relato.nivel_seguranca]}</span>
          <span class="badge-categoria">${PERIODO_LABEL[relato.periodo] || relato.periodo}</span>
        </div>
        ${relato.descricao ? `<p>${escaparHtml(relato.descricao)}</p>` : '<p class="field-hint">Sem descrição adicional.</p>'}
        <p class="detalhe-meta">Por ${escaparHtml(autor)} · ${formatarData(relato.created_at)}</p>
        <div class="votos-linha">
          <button type="button" class="voto-btn voto-concordo ${resumo.meuVoto === 'concordo' ? 'ativo' : ''}" data-voto="concordo">
            👍 Concordo (${resumo.concordo})
          </button>
          <button type="button" class="voto-btn voto-discordo ${resumo.meuVoto === 'discordo' ? 'ativo' : ''}" data-voto="discordo">
            👎 Não concordo (${resumo.discordo})
          </button>
        </div>
      </div>`;
    })
    .join('');

  el('listaDetalhes').querySelectorAll('.voto-btn').forEach((btn) => {
    btn.addEventListener('click', () => registrarVoto(btn.closest('[data-relato-id]').dataset.relatoId, btn.dataset.voto));
  });
}

function pontuacaoVoto(relatoId) {
  const r = estado.votosResumo[relatoId];
  return r ? r.concordo - r.discordo : 0;
}

async function registrarVoto(relatoId, voto) {
  if (!estado.usuario) return;
  const atual = estado.votosResumo[relatoId]?.meuVoto;

  try {
    if (atual === voto) {
      await Votos.removerVoto({ localId: relatoId, usuarioId: estado.usuario.id });
    } else {
      await Votos.votar({ localId: relatoId, usuarioId: estado.usuario.id, voto });
    }
    estado.votosResumo = await Votos.buscarResumoVotos(estado.usuario.id);
    reabrirDetalhesAtual();
  } catch (err) {
    mostrarToast('Não foi possível registrar seu voto. ' + (err.message || ''), 'erro');
  }
}

/* ============================================================
   MINI MAPA COM GEOCODIFICAÇÃO (reutilizável)
   ============================================================ */
function criarMiniMapa(containerId) {
  const instancia = L.map(containerId, { attributionControl: false }).setView([-22.9068, -43.1729], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(instancia);

  const controlador = {
    mapa: instancia,
    marcador: null,
    posicaoTentativa: null,
    definirPosicao(lat, lng) {
      this.posicaoTentativa = { lat, lng };
      if (this.marcador) {
        this.marcador.setLatLng([lat, lng]);
      } else {
        this.marcador = L.marker([lat, lng], { draggable: true }).addTo(instancia);
        this.marcador.on('dragend', () => {
          const pos = this.marcador.getLatLng();
          this.posicaoTentativa = { lat: pos.lat, lng: pos.lng };
          if (controlador.aoMudarPosicao) controlador.aoMudarPosicao(this.posicaoTentativa);
        });
      }
      instancia.setView([lat, lng], 17);
      if (controlador.aoMudarPosicao) controlador.aoMudarPosicao(this.posicaoTentativa);
    },
    limpar() {
      if (this.marcador) { instancia.removeLayer(this.marcador); this.marcador = null; }
      this.posicaoTentativa = null;
      instancia.setView([-22.9068, -43.1729], 12);
    },
    aoMudarPosicao: null
  };

  instancia.on('click', (e) => controlador.definirPosicao(e.latlng.lat, e.latlng.lng));
  setTimeout(() => instancia.invalidateSize(), 250);
  return controlador;
}

let miniMapaLocal = null;
let miniMapaInstituicao = null;

/* ============================================================
   MODAL: CADASTRAR RELATO
   ============================================================ */
function registrarEventosCadastroLocal() {
  const buscarEndereco = comDebounce(async () => {
    const rua = el('localRua').value.trim();
    const numero = el('localNumero').value.trim();
    const bairro = el('localBairro').value.trim();
    if (!rua || !bairro) return;

    el('statusGeocodificacao').textContent = 'Localizando endereço...';
    const consulta = `${rua}, ${numero}, ${bairro}, Brasil`;
    const resultado = await geocodificarEndereco(consulta);

    if (resultado && miniMapaLocal) {
      miniMapaLocal.definirPosicao(resultado.lat, resultado.lng);
      el('statusGeocodificacao').textContent =
        'Endereço localizado! Ajuste o pino se necessário e clique em "Confirmar localização".';
      el('btnConfirmarLocalizacao').disabled = false;
    } else {
      el('statusGeocodificacao').textContent =
        'Não encontramos esse endereço automaticamente. Clique no mapa abaixo para marcar o local manualmente.';
    }
  }, 800);

  ['localRua', 'localNumero', 'localBairro'].forEach((id) => el(id).addEventListener('input', buscarEndereco));

  el('btnConfirmarLocalizacao').addEventListener('click', () => {
    if (!miniMapaLocal?.posicaoTentativa) return;
    el('coordSelecionada').textContent =
      `Localização confirmada: ${miniMapaLocal.posicaoTentativa.lat.toFixed(5)}, ${miniMapaLocal.posicaoTentativa.lng.toFixed(5)} ✓`;
    el('coordSelecionada').dataset.confirmado = 'true';
  });

  el('formLocal').addEventListener('submit', enviarFormLocal);
}

function abrirModalLocal() {
  fecharTodosOsModais();
  el('formLocal').reset();
  el('statusGeocodificacao').textContent =
    'Digite o endereço acima — o mapa localiza automaticamente. Você também pode arrastar o pino ou clicar no mapa para ajustar.';
  el('coordSelecionada').textContent = 'Nenhum ponto confirmado ainda.';
  el('coordSelecionada').dataset.confirmado = 'false';
  el('btnConfirmarLocalizacao').disabled = true;
  el('modalLocal').hidden = false;

  if (!miniMapaLocal) miniMapaLocal = criarMiniMapa('miniMapaCadastro');
  miniMapaLocal.limpar();
  setTimeout(() => miniMapaLocal.mapa.invalidateSize(), 150);
}

async function enviarFormLocal(e) {
  e.preventDefault();

  if (el('coordSelecionada').dataset.confirmado !== 'true' || !miniMapaLocal?.posicaoTentativa) {
    mostrarToast('Confirme a localização no mapa antes de salvar.', 'erro');
    return;
  }

  const dados = {
    nome: el('localNome').value.trim(),
    bairro: el('localBairro').value.trim(),
    categoria: el('localCategoria').value,
    nivelSeguranca: document.querySelector('input[name="nivelSeguranca"]:checked')?.value,
    periodo: el('localPeriodo').value,
    descricao: el('localDescricao').value.trim(),
    anonimo: el('localAnonimo').checked,
    latitude: miniMapaLocal.posicaoTentativa.lat,
    longitude: miniMapaLocal.posicaoTentativa.lng,
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
    mostrarToast('Relato cadastrado! Obrigada por contribuir. 💜', 'sucesso');
    el('modalLocal').hidden = true;
    await carregarLocais();
  } catch (err) {
    mostrarToast('Não foi possível salvar o relato. ' + (err.message || ''), 'erro');
  } finally {
    definirCarregando('formLocal', false);
  }
}

/* ============================================================
   MODAL: CADASTRAR INSTITUIÇÃO (DELEGACIA / PONTO DE APOIO)
   ============================================================ */
function registrarEventosCadastroInstituicao() {
  const buscarEndereco = comDebounce(async () => {
    const endereco = el('instituicaoEndereco').value.trim();
    if (endereco.length < 5) return;

    el('statusGeocodificacaoInstituicao').textContent = 'Localizando endereço...';
    const resultado = await geocodificarEndereco(`${endereco}, Brasil`);

    if (resultado && miniMapaInstituicao) {
      miniMapaInstituicao.definirPosicao(resultado.lat, resultado.lng);
      el('statusGeocodificacaoInstituicao').textContent =
        'Endereço localizado! Ajuste o pino se necessário e clique em "Confirmar localização".';
      el('btnConfirmarLocalizacaoInstituicao').disabled = false;
    } else {
      el('statusGeocodificacaoInstituicao').textContent =
        'Não encontramos esse endereço automaticamente. Clique no mapa abaixo para marcar manualmente.';
    }
  }, 800);

  el('instituicaoEndereco').addEventListener('input', buscarEndereco);

  el('btnConfirmarLocalizacaoInstituicao').addEventListener('click', () => {
    if (!miniMapaInstituicao?.posicaoTentativa) return;
    el('btnConfirmarLocalizacaoInstituicao').textContent = '✓ Localização confirmada';
    el('btnConfirmarLocalizacaoInstituicao').dataset.confirmado = 'true';
  });

  el('formInstituicao').addEventListener('submit', enviarFormInstituicao);
}

function abrirModalInstituicao() {
  fecharTodosOsModais();
  el('formInstituicao').reset();
  el('statusGeocodificacaoInstituicao').textContent = 'Digite o endereço acima — o mapa localiza automaticamente.';
  el('btnConfirmarLocalizacaoInstituicao').disabled = true;
  el('btnConfirmarLocalizacaoInstituicao').textContent = '📍 Confirmar localização';
  el('btnConfirmarLocalizacaoInstituicao').dataset.confirmado = 'false';
  el('modalInstituicao').hidden = false;

  if (!miniMapaInstituicao) miniMapaInstituicao = criarMiniMapa('miniMapaInstituicao');
  miniMapaInstituicao.limpar();
  setTimeout(() => miniMapaInstituicao.mapa.invalidateSize(), 150);
}

async function enviarFormInstituicao(e) {
  e.preventDefault();

  if (el('btnConfirmarLocalizacaoInstituicao').dataset.confirmado !== 'true' || !miniMapaInstituicao?.posicaoTentativa) {
    mostrarToast('Confirme a localização no mapa antes de salvar.', 'erro');
    return;
  }

  const tipo = document.querySelector('input[name="instituicaoTipo"]:checked')?.value;
  if (!tipo) {
    mostrarToast('Selecione se é uma delegacia ou um ponto de apoio.', 'erro');
    return;
  }

  try {
    definirCarregando('formInstituicao', true);
    await Instituicoes.criarInstituicao({
      tipo,
      nome: el('instituicaoNome').value.trim(),
      endereco: el('instituicaoEndereco').value.trim(),
      telefone: el('instituicaoTelefone').value.trim(),
      latitude: miniMapaInstituicao.posicaoTentativa.lat,
      longitude: miniMapaInstituicao.posicaoTentativa.lng,
      autorId: estado.usuario.id
    });
    mostrarToast('Cadastrado com sucesso! Obrigada por fortalecer a rede. 💜', 'sucesso');
    el('modalInstituicao').hidden = true;
    await carregarInstituicoes();
  } catch (err) {
    mostrarToast('Não foi possível salvar. ' + (err.message || ''), 'erro');
  } finally {
    definirCarregando('formInstituicao', false);
  }
}

/* ============================================================
   MURAL DE AVISOS
   ============================================================ */
async function carregarMural() {
  try {
    const posts = await Comunidade.buscarPosts();
    renderizarPosts(posts);
  } catch (err) {
    mostrarToast('Não foi possível carregar o mural. ' + (err.message || ''), 'erro');
  }
}

function renderizarPosts(posts) {
  const lista = el('listaPosts');
  if (posts.length === 0) {
    lista.innerHTML = `<p class="estado-vazio">Ainda não há avisos. Seja a primeira a publicar.</p>`;
    return;
  }

  lista.innerHTML = posts
    .map((post) => {
      const autor = post.anonimo ? 'Anônima' : post.autor_nome;
      return `
      <div class="post-item tipo-${post.tipo}">
        <div class="post-cabecalho">
          <strong>${escaparHtml(autor)}</strong>
          <span class="badge-tipo">${rotuloTipoPost(post.tipo)}</span>
          <span class="post-data post-tempo" data-created="${post.created_at}">${Comunidade.formatarTempoRelativo(post.created_at)}</span>
        </div>
        <p>${escaparHtml(post.conteudo)}</p>
      </div>`;
    })
    .join('');

  lista.scrollTop = lista.scrollHeight;
}

function rotuloTipoPost(tipo) {
  return { relato: 'Relato', duvida: 'Dúvida', aviso: 'Aviso' }[tipo] || tipo;
}

function ativarRealtimeMural() {
  if (estado.canais.mural) return;
  estado.canais.mural = Comunidade.inscreverNovosPosts(async () => {
    const posts = await Comunidade.buscarPosts();
    renderizarPosts(posts);
  });
}

async function enviarPost(e) {
  e.preventDefault();
  const conteudo = el('postConteudo').value;
  const tipo = el('postTipo').value;
  const anonimo = el('postAnonimo').checked;

  try {
    definirCarregando('formPost', true);
    await Comunidade.publicarPost({
      autorId: estado.usuario.id,
      autorNome: estado.perfil?.nome || estado.usuario.email,
      conteudo,
      tipo,
      anonimo
    });
    el('postConteudo').value = '';
    el('postAnonimo').checked = false;
    await carregarMural();
  } catch (err) {
    mostrarToast(err.message || 'Não foi possível publicar.', 'erro');
  } finally {
    definirCarregando('formPost', false);
  }
}

// Atualiza os carimbos "há X min" a cada 30s, sem precisar recarregar os posts.
setInterval(() => {
  document.querySelectorAll('.post-tempo[data-created]').forEach((elemento) => {
    elemento.textContent = Comunidade.formatarTempoRelativo(elemento.dataset.created);
  });
}, 30000);

/* ============================================================
   PERFIL
   ============================================================ */
async function abrirModalPerfil() {
  fecharTodosOsModais();

  if (!estado.perfil && estado.usuario) {
    try { estado.perfil = await Auth.obterPerfil(estado.usuario.id); } catch { /* mantém null */ }
  }

  if (!estado.perfil) {
    el('perfilNome').textContent = '—';
    el('perfilEmail').textContent = estado.usuario?.email || '—';
    el('perfilContato').textContent = '—';
    mostrarToast('Não encontramos seu contato de emergência. Saia e crie a conta novamente para corrigir isso.', 'erro', 7000);
  } else {
    el('perfilNome').textContent = estado.perfil.nome || '—';
    el('perfilEmail').textContent = estado.perfil.email || estado.usuario?.email || '—';
    el('perfilContato').textContent = estado.perfil.contato_emergencia || '—';
  }

  el('modalPerfil').hidden = false;
}

/* ============================================================
   SOS
   ============================================================ */
async function acionarEmergenciaWhatsApp() {
  const contato = estado.perfil?.contato_emergencia;
  const btn = el('btnEmergenciaWhatsApp');
  btn.disabled = true;

  try {
    const { url } = await obterLinkDeEmergencia(contato);
    window.open(url, '_blank', 'noopener');
    mostrarToast('Localização pronta para envio no WhatsApp.', 'sucesso');
    el('sosMenu').hidden = true;
  } catch (err) {
    mostrarToast(err.message, 'erro', 7000);
  } finally {
    btn.disabled = false;
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
