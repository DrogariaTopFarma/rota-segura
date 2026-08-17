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
    (linkMapa) => `🚨 Preciso de ajuda agora. Esta é a minha localização em tempo real: ${linkMapa}`
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
