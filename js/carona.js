/* ============================================================================
   ROTA SEGURA — Acompanhar corrida (Uber/99), Tela 2

   Não lê o GPS de dentro do Uber/99 — não existe API pública que deixe um
   app terceiro observar uma corrida alheia (testado: as APIs oficiais das
   duas são pra empresa que PEDE a corrida pela API, não pra acompanhar uma
   corrida que a própria usuária já chamou no app normal dela). Em vez
   disso: ela cola o link de "compartilhar corrida" que o próprio Uber/99 já
   gera, define o horário esperado de chegada, e o app lembra ela de
   confirmar que chegou bem — escalando pra um aviso mais urgente se passar
   do prazo sem confirmação (ver supabase/functions/verificar-corridas).

   LIMITE HONESTO (repetido do texto fixo na tela, não só aqui): isso é uma
   camada de lembrete/tranquilidade, nunca um substituto de ligar pra 190.
   O app NUNCA avisa o contato de emergência sozinho — ele não é usuária do
   app, não tem assinatura de push — só lembra a própria usuária de fazer
   isso com um toque (mesmo princípio de js/emergency.js).
   ============================================================================ */

import { exigirLogin } from './auth.js';
import { supabase, traduzirErro } from './supabase.js';
import { toast, botaoCarregando, mostrarMensagem, limparMensagem } from './ui.js';
import { obterLinkDeAcompanhamento, obterLinkDeConfirmacaoAtrasada, formatarTelefoneParaWhatsApp } from './emergency.js';

let usuarioAtual = null;
let corridaAtualId = null;
let corridaAtualLink = null;
let corridaAtualDestino = null;
let corridaAtualChegada = null;
let corridaEstaAtrasada = false;
let intervaloContador = null;

async function iniciar() {
  const usuario = await exigirLogin();
  if (!usuario) return;
  usuarioAtual = usuario;

  if (!document.getElementById('painel-carona')) return; // página sem esse painel

  prepararNavegacaoDoPainel();
  prepararFormulario();
  prepararBotoesDeAcompanhamento();

  // Veio de um toque na notificação push (?confirmarCorrida=<id>)? Abre
  // direto na corrida certa, sem precisar navegar até lá na mão.
  const idDaUrl = new URLSearchParams(window.location.search).get('confirmarCorrida');
  if (idDaUrl) {
    abrirPainelCarona();
    await carregarCorrida(idDaUrl);
    return;
  }

  // Sem parâmetro na URL: se já existe uma corrida ativa não confirmada,
  // mostra ela direto — sair da tela e voltar não pode "perder" o
  // acompanhamento que já tinha começado.
  await verificarCorridaEmAndamento();
}

function prepararNavegacaoDoPainel() {
  document.getElementById('abrir-painel-carona')?.addEventListener('click', abrirPainelCarona);
  document.getElementById('carona-voltar')?.addEventListener('click', fecharPainelCarona);
}

// Guarda se o cartão de resumo de rota estava visível ANTES de abrir o
// painel de carona, pra devolver exatamente esse estado ao fechar — nunca
// forçar visível (mostraria um cartão vazio se não havia rota nenhuma).
let rotaCardEstavaVisivel = false;

function abrirPainelCarona() {
  document.getElementById('painel-planejamento').hidden = true;
  document.getElementById('painel-carona').hidden = false;
  // Se já existia uma rota calculada (mapa desenhado + cartão de resumo),
  // isso ficava visível atrás do painel de carona — some enquanto o
  // acompanhamento está aberto (o estado da rota em si não é apagado, só
  // escondido: volta do jeito que estava ao fechar este painel).
  document.getElementById('rota-mapa-wrapper').hidden = true;
  const rotaCard = document.getElementById('rota-card');
  rotaCardEstavaVisivel = !rotaCard.hidden;
  rotaCard.hidden = true;
}

function fecharPainelCarona() {
  pararContador();
  corridaAtualId = null;
  corridaAtualLink = null;
  corridaAtualDestino = null;
  corridaAtualChegada = null;
  corridaEstaAtrasada = false;
  document.getElementById('painel-carona').hidden = true;
  document.getElementById('painel-planejamento').hidden = false;
  document.getElementById('rota-mapa-wrapper').hidden = false;
  document.getElementById('rota-card').hidden = !rotaCardEstavaVisivel;
  // Volta pro estado de formulário (caso reabra do zero depois de confirmar/encerrar).
  document.getElementById('form-carona').hidden = false;
  document.getElementById('carona-acompanhando').hidden = true;
}

async function verificarCorridaEmAndamento() {
  const { data } = await supabase
    .from('monitored_trips')
    .select('id,destino_texto,expected_arrival_at,status,share_link')
    .eq('user_id', usuarioAtual.id)
    .eq('status', 'ativa')
    .is('confirmed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    abrirPainelCarona();
    mostrarEstadoAcompanhando(data);
  }
}

async function carregarCorrida(id) {
  const { data, error } = await supabase
    .from('monitored_trips')
    .select('id,destino_texto,expected_arrival_at,status,share_link')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    toast('Não encontrei essa corrida — pode já ter sido encerrada.', 'erro');
    fecharPainelCarona();
    return;
  }
  mostrarEstadoAcompanhando(data);
}

/** Busca o contato de emergência principal — mesma consulta já usada em
    acionarSos (js/routes.js) e compartilharRota (js/navigation.js). */
async function buscarContatoPrincipal() {
  const { data: contatos, error } = await supabase
    .from('emergency_contacts')
    .select('phone')
    .eq('user_id', usuarioAtual.id)
    .order('is_primary', { ascending: false })
    .limit(1);
  if (error) throw error;
  return contatos?.[0] || null;
}

/** Abre o wa.me com o contato principal, usando `montarLink` (uma das duas
    funções de emergency.js) pro texto — mesmo padrão de abrir a aba em
    branco ANTES do await pra não ser bloqueado como pop-up (ver
    acionarSos em js/routes.js, que tem o comentário completo do porquê). */
async function abrirWhatsAppComContatoPrincipal(montarLink, ...args) {
  const janela = window.open('', '_blank');
  if (janela) janela.opener = null;
  try {
    const contato = await buscarContatoPrincipal();
    if (!contato) {
      janela?.close();
      toast('Cadastre um contato de emergência no seu perfil antes.', 'atencao');
      return;
    }
    const { url } = await montarLink(contato.phone, ...args);
    if (janela) janela.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (erro) {
    janela?.close();
    toast(erro.message || 'Não foi possível abrir o WhatsApp agora.', 'erro', 6000);
  }
}

/** <input type="time"> só dá HH:MM, sempre relativo a hoje — se o horário
    digitado já passou (ex.: são 23h50 e ela pôs 23h40, corrida que
    atravessa a meia-noite), assume amanhã em vez de "no passado". Usada
    tanto no submit quanto no "Avisar agora" (precisa do mesmo cálculo antes
    mesmo de salvar, pra mandar a mensagem com o horário certo). */
function calcularChegadaEsperada(horaTexto) {
  const agora = new Date();
  const [hora, minuto] = horaTexto.split(':').map(Number);
  const chegada = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), hora, minuto, 0);
  if (chegada.getTime() <= agora.getTime()) chegada.setDate(chegada.getDate() + 1);
  return chegada;
}

function prepararFormulario() {
  const form = document.getElementById('form-carona');
  if (!form) return;
  const msg = document.getElementById('mensagem-carona');

  document.getElementById('carona-avisar-agora')?.addEventListener('click', () => {
    const link = form.link.value.trim();
    const horaTexto = form.chegada.value;
    const destino = form.destino.value.trim();
    if (!link || !horaTexto || !destino) {
      mostrarMensagem(msg, 'Preencha o link, o destino e o horário esperado antes de avisar.', 'atencao');
      return;
    }
    abrirWhatsAppComContatoPrincipal(obterLinkDeAcompanhamento, {
      destino,
      horario: calcularChegadaEsperada(horaTexto),
      linkCorrida: link
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    const link = form.link.value.trim();
    const destino = form.destino.value.trim();
    const horaTexto = form.chegada.value;

    if (!link) return mostrarMensagem(msg, 'Cole o link de compartilhamento da corrida.', 'atencao');
    if (!destino) return mostrarMensagem(msg, 'Diga pra onde você está indo.', 'atencao');
    if (!horaTexto) return mostrarMensagem(msg, 'Defina o horário esperado de chegada.', 'atencao');

    const chegadaEsperada = calcularChegadaEsperada(horaTexto);

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');
    try {
      const { data, error } = await supabase
        .from('monitored_trips')
        .insert({
          user_id: usuarioAtual.id,
          share_link: link,
          destino_texto: destino,
          expected_arrival_at: chegadaEsperada.toISOString()
        })
        .select('id,destino_texto,expected_arrival_at,status,share_link')
        .single();
      if (error) throw error;

      toast('Acompanhamento iniciado. Avisamos você se passar do horário sem confirmar.', 'sucesso');
      form.reset();
      mostrarEstadoAcompanhando(data);
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(msg, traduzirErro(erro), 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}

function prepararBotoesDeAcompanhamento() {
  document.getElementById('carona-cheguei-bem')?.addEventListener('click', async () => {
    if (!corridaAtualId) return;
    const botao = document.getElementById('carona-cheguei-bem');
    botaoCarregando(botao, true, 'Confirmando...');
    try {
      const { error } = await supabase
        .from('monitored_trips')
        .update({ confirmed_at: new Date().toISOString(), status: 'confirmada' })
        .eq('id', corridaAtualId);
      if (error) throw error;
      toast('Que bom que chegou bem!', 'sucesso');
      fecharPainelCarona();
    } catch (erro) {
      console.error(erro);
      toast(traduzirErro(erro), 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });

  // Botão sempre visível (não só depois de atrasar) — a mensagem que ele manda
  // é que muda: calma (mesmo texto do "Avisar agora") antes do prazo vencer,
  // e no tom urgente de "ainda não confirmei" depois de atrasada — só nesse
  // segundo caso é que registra escalated_at/status='escalada'.
  document.getElementById('carona-compartilhar-contato')?.addEventListener('click', async () => {
    if (corridaEstaAtrasada) {
      abrirWhatsAppComContatoPrincipal(obterLinkDeConfirmacaoAtrasada, { linkCorrida: corridaAtualLink });
      // Só registro (não bloqueia o WhatsApp acima se falhar) — fica marcado
      // que essa corrida teve uma resposta "Não" pra "Está tudo bem?".
      if (corridaAtualId) {
        try {
          await supabase.from('monitored_trips')
            .update({ escalated_at: new Date().toISOString(), status: 'escalada' })
            .eq('id', corridaAtualId);
        } catch (erro) {
          console.error(erro);
        }
      }
    } else {
      abrirWhatsAppComContatoPrincipal(obterLinkDeAcompanhamento, {
        destino: corridaAtualDestino,
        horario: corridaAtualChegada,
        linkCorrida: corridaAtualLink
      });
    }
  });

  // Diferente de "Compartilhar com contato" (manda mensagem pelo WhatsApp):
  // liga de verdade — às vezes uma ligação chama mais atenção do que uma
  // mensagem que a pessoa só vai ler depois.
  document.getElementById('carona-ligar-contato')?.addEventListener('click', async () => {
    try {
      const contato = await buscarContatoPrincipal();
      if (!contato) {
        toast('Cadastre um contato de emergência no seu perfil antes.', 'atencao');
        return;
      }
      const numero = formatarTelefoneParaWhatsApp(contato.phone);
      if (!numero) {
        toast('Não foi possível identificar o telefone do contato.', 'erro');
        return;
      }
      window.location.href = `tel:+${numero}`;
    } catch (erro) {
      console.error(erro);
      toast('Não foi possível ligar agora.', 'erro');
    }
  });

  document.getElementById('carona-encerrar')?.addEventListener('click', async () => {
    if (corridaAtualId) {
      try {
        await supabase.from('monitored_trips').update({ status: 'encerrada_manual' }).eq('id', corridaAtualId);
      } catch {
        // Encerrar continua liberado do lado da usuária mesmo se a gravação falhar.
      }
    }
    fecharPainelCarona();
  });
}

function mostrarEstadoAcompanhando(corrida) {
  corridaAtualId = corrida.id;
  corridaAtualLink = corrida.share_link || null;
  corridaAtualDestino = corrida.destino_texto || null;
  corridaAtualChegada = new Date(corrida.expected_arrival_at);
  document.getElementById('form-carona').hidden = true;
  document.getElementById('carona-acompanhando').hidden = false;

  document.getElementById('carona-destino-texto').textContent =
    corrida.destino_texto ? `Indo para ${corrida.destino_texto}` : '';

  atualizarContador(corrida.expected_arrival_at);
  pararContador();
  intervaloContador = setInterval(() => atualizarContador(corrida.expected_arrival_at), 30000);
}

/** "8 min", "1h", "1h30" — evita mostrar um número gigante de minutos quando
    o prazo (ou o atraso) passa de uma hora. */
function formatarDuracao(min) {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${resto}`;
}

/** Texto do contador — função pura (sem DOM), testável isolada com um
    horário simulado. Usa Math.ceil (não Math.round) pro "chega em": com
    round, faltando só 20-30s pro prazo isso já arredondava pra 0 e caía no
    "atrasada" ANTES da hora combinada realmente passar — agora qualquer
    tempo restante, por menor que seja, ainda conta como "chega em 1 min",
    e só vira atrasada quando o prazo passa de verdade (diff <= 0). */
export function textoContador(expectedArrivalAtIso, agora = new Date()) {
  const prazo = new Date(expectedArrivalAtIso);
  const diffMs = prazo.getTime() - agora.getTime();
  if (diffMs > 0) {
    const diffMin = Math.ceil(diffMs / 60000);
    return { texto: `Chega em ${formatarDuracao(diffMin)}`, atrasada: false };
  }
  const atrasoMin = Math.floor(Math.abs(diffMs) / 60000);
  return { texto: `Atrasada há ${formatarDuracao(atrasoMin)}`, atrasada: true };
}

function atualizarContador(expectedArrivalAtIso) {
  const elemento = document.getElementById('carona-contador');
  if (!elemento) return;
  const { texto, atrasada } = textoContador(expectedArrivalAtIso);
  elemento.textContent = texto;
  elemento.classList.toggle('rota-carona__contador--atrasada', atrasada);
  corridaEstaAtrasada = atrasada;
  // "Está tudo bem?" só faz sentido depois que o horário esperado passou —
  // antes disso ninguém precisa responder nada, só acompanhar a contagem.
  // Os botões (Cheguei bem / Compartilhar com contato) ficam sempre visíveis.
  document.getElementById('carona-pergunta').hidden = !atrasada;
}

function pararContador() {
  if (intervaloContador) {
    clearInterval(intervaloContador);
    intervaloContador = null;
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
