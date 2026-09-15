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
 * Usado pelo "Acompanhar corrida" (js/carona.js) no botão "Avisar agora que
 * comecei a corrida" — diferente de obterLinkDeCompartilhamento, inclui
 * também o link de acompanhamento da própria corrida (Uber/99) e o horário
 * esperado de chegada, pra quem recebe já poder abrir e ver o trajeto ao
 * vivo, não só a localização pontual de agora.
 */
export function obterLinkDeAcompanhamento(contato, { destino, horario, linkCorrida }) {
  return construirLinkDeWhatsApp(
    contato,
    (linkMapa) => {
      const destinoTexto = destino ? ` até ${destino}` : '';
      return `Oi! Comecei uma corrida agora${destinoTexto} e devo chegar até ${formatarHora(horario)}. `
        + `Segue o link de acompanhamento dela: ${linkCorrida}. Minha localização atual: ${linkMapa}`;
    }
  );
}

/**
 * Usado pelo "Acompanhar corrida" (js/carona.js) quando o horário esperado de
 * chegada passou sem confirmação e a usuária responde "Não" pra "Está tudo
 * bem?" — ainda é ELA quem dispara (nunca automático: contato de emergência
 * não é usuária do app, não tem como receber push sozinho), só que o texto
 * já vem pronto e no mesmo tom de urgência do botão SOS.
 */
export function obterLinkDeConfirmacaoAtrasada(contato, { linkCorrida } = {}) {
  return construirLinkDeWhatsApp(
    contato,
    (linkMapa) => {
      const linkTexto = linkCorrida ? ` Link da corrida: ${linkCorrida}.` : '';
      return `Ainda não confirmei que cheguei bem numa corrida que já devia ter chegado. `
        + `Pode me ajudar a conferir?${linkTexto} Minha última localização: ${linkMapa}`;
    }
  );
}
