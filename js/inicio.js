/* ============================================================================
   ROTA SEGURA — Ponto de entrada da Tela Início
   Painel PESSOAL — "isto é sobre você agora", não um resumo genérico
   repetindo Mapa/Comunidade:
     - SOS (ação real).
     - Aviso se não há contato de emergência cadastrado (o SOS depende disso).
     - Status ao vivo se há uma corrida sendo acompanhada agora.
     - Notícias/relatos do SEU entorno (geolocalização best-effort), não só
       "mais recentes globalmente" — isso é o que torna esta tela diferente
       da Comunidade (feed completo) e do Mapa (visão geográfica).
   Não cadastra nada aqui, não tem busca própria — atalhos levam pras telas
   que fazem isso de verdade.
   ============================================================================ */

import { exigirLogin, iniciarAuth, perfilDeCabecalho } from './auth.js';
import { aplicarIcones, icone } from './icons.js';
import { supabase } from './supabase.js';
import {
  prepararModais, prepararTrocaDeModal, toast, escapar, formatarDataHora,
  htmlEstadoVazio, htmlCarregando, distanciaMetros
} from './ui.js';
import { marcarItemAtivo, atualizarBadgeNotificacoes, ligarRealtimeBadgeNotificacoes } from './nav.js';
import { prepararNotificacoes } from './notifications.js';
import { registrarServiceWorker, ligarBotaoInstalarApp } from './pwa.js';
import { ROTULOS_RELATO, ICONE_POR_TIPO_RELATO, corDoRelato, ROTULOS_INCIDENTE_EXTERNO } from './map.js';
import { acionarSos } from './emergency.js';
import { obterPosicao } from './geolocation.js';

const LIMITE_ITENS = 3;
const RAIO_PERTO_M = 2000;

async function iniciar() {
  aplicarIcones();
  registrarServiceWorker('../sw.js');
  ligarBotaoInstalarApp();

  const usuario = await exigirLogin();
  if (!usuario) return;

  iniciarAuth();
  prepararModais();
  prepararTrocaDeModal();
  marcarItemAtivo();
  prepararNotificacoes();

  // Início não tem formulário de cadastro próprio (mesmo princípio de
  // js/routes.js, botão-central lá) — manda pra tela que tem.
  document.getElementById('botao-central')?.addEventListener('click', () => {
    toast('Para cadastrar, vá até a tela do Mapa.', 'info');
    window.location.href = 'mapa.html';
  });

  document.getElementById('inicio-sos-botao')?.addEventListener('click', acionarSos);

  // Localização é best-effort e CURTA (4s, baixa exigência de precisão) —
  // é só pra rotular "perto de você", nunca pra travar a tela esperando
  // GPS: sem permissão/sem sinal, as duas listas caem pro recorte global
  // de sempre, sem erro nenhum aparecer.
  const posicao = await obterPosicao({ precisaoDesejada: 100, tempoMaximo: 4000 }).catch(() => null);

  await Promise.all([
    carregarCabecalho(usuario),
    carregarAlertaContato(usuario),
    carregarCorridaAtiva(usuario),
    carregarUltimasNoticias(posicao),
    carregarRelatosRecentes(posicao),
    atualizarBadgeNotificacoes()
  ]);
  ligarRealtimeBadgeNotificacoes();
}

/** Nome real (não user_metadata, que fica preso no nome do cadastro — ver
    perfilDeCabecalho em auth.js) + foto de perfil, se tiver. */
async function carregarCabecalho(usuario) {
  const { nome, avatarUrl } = await perfilDeCabecalho(usuario);
  const primeiroNome = nome.split(' ')[0];
  document.getElementById('inicio-saudacao').textContent = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';
  document.getElementById('nome-usuaria').textContent = nome;

  const avatar = document.getElementById('inicio-avatar');
  if (avatar && avatarUrl) {
    avatar.innerHTML = `<img src="${escapar(avatarUrl)}" alt="">`;
  }
}

/** O SOS só funciona se houver contato de emergência — sem isso, o botão
    mais importante da tela é decorativo. Só aparece quando falta mesmo
    (não polui com "tudo certo" quando já está configurado). */
async function carregarAlertaContato(usuario) {
  const cartao = document.getElementById('inicio-alerta-contato');
  if (!cartao) return;
  const { count } = await supabase
    .from('emergency_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', usuario.id);
  cartao.hidden = (count ?? 0) > 0;
}

/** Mesma consulta que js/carona.js já faz pra saber se há uma corrida sendo
    acompanhada agora — reaproveitada aqui pra status ao vivo na tela
    Início, sem duplicar a lógica de verdade (que continua só em carona.js). */
async function carregarCorridaAtiva(usuario) {
  const cartao = document.getElementById('inicio-corrida-ativa');
  if (!cartao) return;

  const { data } = await supabase
    .from('monitored_trips')
    .select('expected_arrival_at')
    .eq('user_id', usuario.id)
    .eq('status', 'ativa')
    .is('confirmed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) { cartao.hidden = true; return; }

  const hora = new Date(data.expected_arrival_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('inicio-corrida-hora').textContent = hora;
  cartao.hidden = false;
}

async function carregarUltimasNoticias(posicao) {
  const container = document.getElementById('inicio-noticias');
  const titulo = document.getElementById('inicio-noticias-titulo');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  let consulta = supabase
    .from('external_incidents')
    .select('id,category,title,address,city,lat,lng,published_at,occurred_at,source_url')
    .neq('category', 'geral')
    .in('status', ['active', 'confirmed']);

  consulta = posicao
    ? caixaAoRedor(consulta, posicao).order('published_at', { ascending: false }).limit(50)
    : consulta.order('published_at', { ascending: false }).limit(LIMITE_ITENS);

  const { data, error } = await consulta;
  let itens = data || [];
  if (posicao) {
    itens = itens
      .filter((n) => typeof n.lat === 'number' && typeof n.lng === 'number'
        && distanciaMetros(posicao.lat, posicao.lng, n.lat, n.lng) <= RAIO_PERTO_M)
      .slice(0, LIMITE_ITENS);
    if (titulo) titulo.textContent = 'Notícias perto de você';
  }

  if (error || !itens.length) {
    container.innerHTML = htmlEstadoVazio(
      posicao ? 'Nenhuma notícia pública perto de você ainda.' : 'Nenhuma notícia pública coletada ainda.'
    );
    return;
  }

  container.innerHTML = itens.map((n) => `
    <article class="card-lista">
      <div class="card-lista__icone card-lista__icone--roxo">${icone('alerta', 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(n.title)}</div>
        <div class="card-lista__meta">
          ${escapar(ROTULOS_INCIDENTE_EXTERNO[n.category] || 'Notícia')}
          ${n.address || n.city ? ' · ' + escapar(n.address || n.city) : ''}
        </div>
      </div>
    </article>`).join('');
}

async function carregarRelatosRecentes(posicao) {
  const container = document.getElementById('inicio-relatos');
  const titulo = document.getElementById('inicio-relatos-titulo');
  if (!container) return;
  container.innerHTML = htmlCarregando(2);

  const agora = new Date().toISOString();
  let consulta = supabase
    .from('reports')
    .select('id,type,address,lat,lng,occurred_at,attention_level,status,expires_at')
    .eq('status', 'approved')
    .or(`expires_at.is.null,expires_at.gt.${agora}`);

  consulta = posicao
    ? caixaAoRedor(consulta, posicao).order('occurred_at', { ascending: false }).limit(200)
    : consulta.order('occurred_at', { ascending: false }).limit(LIMITE_ITENS);

  const { data, error } = await consulta;
  let itens = data || [];
  if (posicao) {
    itens = itens
      .filter((r) => distanciaMetros(posicao.lat, posicao.lng, r.lat, r.lng) <= RAIO_PERTO_M)
      .slice(0, LIMITE_ITENS);
    if (titulo) titulo.textContent = 'Relatos perto de você';
  }

  if (error || !itens.length) {
    container.innerHTML = htmlEstadoVazio(
      posicao ? 'Nenhum relato perto de você ainda.' : 'Nenhum relato por perto ainda.'
    );
    return;
  }

  container.innerHTML = itens.map((r) => `
    <article class="card-lista">
      <div class="card-lista__icone" style="background:${corDoRelato(r)}">${icone(ICONE_POR_TIPO_RELATO[r.type] || 'escudo', 22)}</div>
      <div class="card-lista__conteudo">
        <div class="card-lista__titulo">${escapar(ROTULOS_RELATO[r.type] || 'Relato')}</div>
        <div class="card-lista__meta">${escapar(formatarDataHora(r.occurred_at))}${r.address ? ' · ' + escapar(r.address) : ''}</div>
      </div>
    </article>`).join('');
}

/** Caixa (bounding box) de ~RAIO_PERTO_M ao redor da posição — mesmo padrão
    de pré-filtro já usado em js/search.js (contarRelatosProximos): barato
    no banco, o filtro exato por distância vem depois, em JS. */
function caixaAoRedor(consulta, posicao) {
  const delta = RAIO_PERTO_M / 111000;
  return consulta
    .gte('lat', posicao.lat - delta).lte('lat', posicao.lat + delta)
    .gte('lng', posicao.lng - delta).lte('lng', posicao.lng + delta);
}

document.addEventListener('DOMContentLoaded', iniciar);
