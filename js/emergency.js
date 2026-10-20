/* ============================================================
   ROTA SEGURA — emergency.js
   Botão de emergência: pega a geolocalização exata da usuária e
   abre o WhatsApp do contato de emergência com a localização.

   DECISÃO DE PRIVACIDADE (importante):
   A localização NUNCA é salva no banco de dados — ela é lida do
   navegador e usada só para montar o link do WhatsApp, na hora.
   Isso evita criar um histórico de localização da usuária que,
   se vazado, seria um risco de segurança justamente para quem o
   app deveria proteger.
   ============================================================ */

import { acompanharPosicao } from './geolocation.js';
import { supabase } from './supabase.js';
import { abrirModal, toast, escapar } from './ui.js';

/**
 * Formata um telefone para o padrão que o wa.me exige: só dígitos,
 * com código do país. Se a usuária cadastrou "(21) 99999-9999",
 * assumimos Brasil (+55) quando não há código de país explícito.
 */
export function formatarTelefoneParaWhatsApp(telefone) {
  let digitos = (telefone || '').replace(/\D/g, '');
  if (!digitos) return null;

  // Sem código de país (número curto, formato BR de 10-11 dígitos): prefixa 55.
  if (digitos.length <= 11) {
    digitos = '55' + digitos;
  }
  return digitos;
}

// "Última posição conhecida", mantida em segundo plano por
// iniciarCacheDeLocalizacao() — ver o comentário lá embaixo pra entender por
// que isso existe (não é só por velocidade).
let posicaoCache = null;
let pararCache = null;
const IDADE_MAXIMA_CACHE_MS = 2 * 60 * 1000; // 2 minutos

/**
 * Liga um acompanhamento leve de localização em segundo plano (mesma
 * `acompanharPosicao` que js/map.js já usa pra manter a posição da Tela 1
 * atualizada) só para ter uma leitura pronta quando SOS/compartilhar forem
 * tocados — chamar uma vez ao carregar uma página com esses botões
 * (idempotente: chamar de novo não abre um segundo watch). Silencioso no
 * erro de propósito: é um cache de melhor esforço, o `getCurrentPosition`
 * direto dentro de construirLinkDeWhatsApp continua sendo a fonte confiável
 * quando ainda não há nada em cache (ex.: primeiro toque assim que a página
 * abre, antes do GPS responder pela primeira vez).
 */
export function iniciarCacheDeLocalizacao() {
  if (pararCache) return;
  pararCache = acompanharPosicao((posicao) => { posicaoCache = posicao; }, () => {});
}

/**
 * Pega a localização atual e monta a URL do wa.me pronta para abrir, com a
 * mensagem que a chamadora decidir. Reaproveitado tanto pelo SOS (mensagem de
 * emergência) quanto pelo "Compartilhar rota" (mensagem tranquila, avisando
 * pra onde você está indo) — só o texto muda, o resto do fluxo é idêntico.
 */
function construirLinkDeWhatsApp(contato, montarMensagem) {
  return new Promise((resolve, reject) => {
    const numero = formatarTelefoneParaWhatsApp(contato);
    if (!numero) {
      reject(new Error('Cadastre um contato de emergência no seu perfil antes de usar este botão.'));
      return;
    }

    // Se já existe uma leitura recente em cache, usa ela na hora, sem esperar
    // o GPS de novo. Isso não é só sobre velocidade percebida: no iPhone, o
    // wa.me só entra DIRETO no app instalado (sem passar pela página
    // intermediária do navegador) quando a navegação acontece bem perto do
    // toque original — esperar o GPS de verdade (pode levar vários segundos)
    // quebra essa janela e o Safari trata como se não fosse mais um clique
    // da usuária. O Android é mais tolerante com isso, por isso o problema
    // aparecia só no iPhone/computador, nunca lá.
    if (posicaoCache && Date.now() - posicaoCache.quando <= IDADE_MAXIMA_CACHE_MS) {
      const linkMapa = `https://www.google.com/maps?q=${posicaoCache.lat},${posicaoCache.lng}`;
      const url = `https://wa.me/${numero}?text=${encodeURIComponent(montarMensagem(linkMapa))}`;
      resolve({ url, latitude: posicaoCache.lat, longitude: posicaoCache.lng });
      return;
    }

    if (!('geolocation' in navigator)) {
      reject(new Error('Seu navegador não suporta compartilhamento de localização.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        const { latitude, longitude } = posicao.coords;
        const linkMapa = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const url = `https://wa.me/${numero}?text=${encodeURIComponent(montarMensagem(linkMapa))}`;
        resolve({ url, latitude, longitude });
      },
      (erro) => {
        const mensagens = {
          1: 'Permissão de localização negada. Ative a localização do navegador para usar este botão.',
          2: 'Não foi possível obter sua localização agora. Tente novamente em instantes.',
          3: 'A busca pela sua localização demorou demais. Tente novamente.'
        };
        reject(new Error(mensagens[erro.code] || 'Erro ao obter localização.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * Pega a localização atual e retorna a URL do wa.me pronta para abrir.
 * Rejeita a Promise com uma mensagem amigável em caso de erro/permissão negada.
 */
export function obterLinkDeEmergencia(contatoEmergencia) {
  return construirLinkDeWhatsApp(
    contatoEmergencia,
    (linkMapa) => `Preciso de ajuda agora. Esta é a minha localização em tempo real: ${linkMapa}`
  );
}

/**
 * Botão SOS completo (usado em Rotas) — manda WhatsApp com localização em
 * tempo real para o contato de emergência principal. Sem contato
 * cadastrado, abre o modal pedindo pra cadastrar (cada página precisa ter
 * `#modal-sos-sem-contato`).
 *
 * Quando existe MAIS de um contato cadastrado, o principal recebe a
 * mensagem na hora (igual sempre foi) e os demais aparecem logo depois num
 * modal próprio (`#modal-sos-outros-contatos`, opcional — página sem ele
 * simplesmente não oferece o passo extra), um botão por contato: rede de
 * apoio de verdade, não só uma pessoa que pode não ver a tempo. Cada um
 * desses botões abre o próprio WhatsApp só quando TOCADO (um clique de
 * verdade por vez) — nunca todos de uma vez junto com o principal, porque
 * vários window.open ao mesmo tempo o navegador trataria como pop-up e
 * bloquearia a maioria.
 */
export async function acionarSos() {
  // BUG DE CONFIABILIDADE QUE ISTO CORRIGE: abrir a aba só depois de esperar
  // o Supabase e o GPS (tudo assíncrono) faz vários navegadores tratarem
  // window.open como pop-up não solicitado e BLOQUEAR silenciosamente — bem
  // no botão que mais precisa funcionar. Abrir a aba em branco JÁ no clique
  // (ainda síncrono) e só trocar a URL dela depois evita isso.
  // IMPORTANTE: sem a flag "noopener" aqui — com ela, window.open() devolve
  // null (testado ao vivo) e a gente perde a referência pra poder navegar a
  // aba depois. Em vez disso, zeramos w.opener manualmente: mesma proteção
  // de segurança (o wa.me não consegue acessar esta página de volta), sem
  // perder a referência.
  const janela = window.open('', '_blank');
  if (janela) {
    janela.opener = null;
    janela.document.write(
      '<title>Abrindo WhatsApp…</title>' +
      '<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;' +
      'font-family:-apple-system,sans-serif;color:#777;text-align:center;padding:24px;">' +
      '<p>Localizando você e abrindo o WhatsApp…</p></body>'
    );
  }
  try {
    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) { janela?.close(); return; }

    const { data: contatos, error } = await supabase
      .from('emergency_contacts')
      .select('name,phone,is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false });

    if (error) throw error;

    if (!contatos || !contatos.length) {
      janela?.close();
      abrirModal('modal-sos-sem-contato');
      return;
    }

    const [principal, ...outros] = contatos;
    const { url } = await obterLinkDeEmergencia(principal.phone);
    if (janela) janela.location.href = url;
    else window.open(url, '_blank', 'noopener');

    if (outros.length) mostrarOutrosContatosSos(outros);
  } catch (erro) {
    janela?.close();
    toast(erro.message || 'Não foi possível acionar o SOS agora.', 'erro', 6000);
  }
}

/** Lista de botões — um por contato ALÉM do principal — dentro de
    `#modal-sos-outros-contatos`. Cada botão só busca localização/monta o
    link quando TOCADO (ver comentário de acionarSos acima sobre por que
    nunca abrir tudo de uma vez). */
function mostrarOutrosContatosSos(contatos) {
  const lista = document.getElementById('sos-outros-contatos-lista');
  if (!lista) return; // página sem este modal — segue sem o passo extra

  lista.innerHTML = contatos.map((c, i) => `
    <button type="button" class="btn btn-secundario btn-bloco" data-sos-outro="${i}">
      Avisar ${escapar(c.name)} também
    </button>`).join('');

  lista.querySelectorAll('[data-sos-outro]').forEach((botao) => {
    botao.addEventListener('click', async () => {
      const contato = contatos[Number(botao.dataset.sosOutro)];
      const janela = window.open('', '_blank');
      if (janela) janela.opener = null;
      botao.disabled = true;
      try {
        const { url } = await obterLinkDeEmergencia(contato.phone);
        if (janela) janela.location.href = url;
        else window.open(url, '_blank', 'noopener');
        botao.textContent = `Avisado: ${contato.name}`;
      } catch (erro) {
        janela?.close();
        botao.disabled = false;
        toast(erro.message || 'Não foi possível abrir o WhatsApp agora.', 'erro');
      }
    });
  });

  abrirModal('modal-sos-outros-contatos');
}

/**
 * Diferente do SOS: não é uma emergência, é avisar antes de qualquer coisa
 * acontecer — "vou pra tal lugar, aqui está onde estou agora". Pensado pra
 * quem quer compartilhar o trajeto com alguém de confiança por precaução,
 * não só pedir ajuda depois que algo já deu errado.
 */
export function obterLinkDeCompartilhamento(contato, nomeDestino) {
  return construirLinkDeWhatsApp(
    contato,
    (linkMapa) => `Oi! Só avisando que estou a caminho de ${nomeDestino}. Minha localização agora: ${linkMapa}`
  );
}

function formatarHora(data) {
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Usado pelo "Acompanhar trajeto" (js/carona.js) no botão "Avisar agora que
 * comecei o trajeto" — diferente de obterLinkDeCompartilhamento, inclui
 * também o horário esperado de chegada e, SE houver (carona de app, link
 * opcional — ver js/carona.js), o link de acompanhamento da própria
 * corrida (Uber/99), pra quem recebe já poder abrir e ver o trajeto ao
 * vivo, não só a localização pontual de agora.
 */
export function obterLinkDeAcompanhamento(contato, { destino, horario, linkCorrida }) {
  return construirLinkDeWhatsApp(
    contato,
    (linkMapa) => {
      const destinoTexto = destino ? ` até ${destino}` : '';
      const textoLinkCorrida = linkCorrida ? ` Segue o link de acompanhamento: ${linkCorrida}.` : '';
      return `Oi! Saí agora${destinoTexto} e devo chegar até ${formatarHora(horario)}.${textoLinkCorrida} `
        + `Minha localização atual: ${linkMapa}`;
    }
  );
}

/**
 * Usado pelo "Acompanhar trajeto" (js/carona.js) quando o horário esperado de
 * chegada passou sem confirmação e a usuária responde "Não" pra "Está tudo
 * bem?" — ainda é ELA quem dispara (nunca automático: contato de emergência
 * não é usuária do app, não tem como receber push sozinho), só que o texto
 * já vem pronto e no mesmo tom de urgência do botão SOS.
 */
export function obterLinkDeConfirmacaoAtrasada(contato, { linkCorrida } = {}) {
  return construirLinkDeWhatsApp(
    contato,
    (linkMapa) => {
      const linkTexto = linkCorrida ? ` Link de acompanhamento: ${linkCorrida}.` : '';
      return `Ainda não confirmei que cheguei bem a um trajeto que já devia ter terminado. `
        + `Pode me ajudar a conferir?${linkTexto} Minha última localização: ${linkMapa}`;
    }
  );
}
