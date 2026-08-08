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
 * Pega a localização atual e retorna a URL do wa.me pronta para abrir.
 * Rejeita a Promise com uma mensagem amigável em caso de erro/permissão negada.
 */
export function obterLinkDeEmergencia(contatoEmergencia) {
  return new Promise((resolve, reject) => {
    const numero = formatarTelefoneParaWhatsApp(contatoEmergencia);
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
        const mensagem =
          `🚨 Preciso de ajuda agora. Esta é a minha localização em tempo real: ${linkMapa}`;
        const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
        resolve({ url, latitude, longitude });
      },
      (erro) => {
        const mensagens = {
          1: 'Permissão de localização negada. Ative a localização do navegador para usar o botão de emergência.',
          2: 'Não foi possível obter sua localização agora. Tente novamente em instantes.',
          3: 'A busca pela sua localização demorou demais. Tente novamente.'
        };
        reject(new Error(mensagens[erro.code] || 'Erro ao obter localização.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
