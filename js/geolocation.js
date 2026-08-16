/* ============================================================================
   ROTA SEGURA — Geolocalização (GPS do navegador)

   POR QUE ESTE ARQUIVO MUDOU:
   O navegador nem sempre usa GPS de verdade. Em notebook e desktop ele
   descobre onde você está pelo Wi-Fi e pelo endereço de internet — e isso
   erra de 500 m a 3 km. É por isso que aparecia "uma rua que não é a sua".

   O que fazemos agora:
   1. maximumAge: 0  -> nunca aceita uma posição velha guardada no navegador.
   2. Pegamos VÁRIAS leituras seguidas e ficamos com a mais precisa.
   3. Devolvemos sempre a precisão em metros, para a tela poder avisar
      quando a localização estiver ruim, em vez de fingir que está boa.
   ============================================================================ */

export const MOTIVOS = {
  SEM_SUPORTE: 'sem_suporte',
  NEGADO: 'negado',
  INDISPONIVEL: 'indisponivel',
  TEMPO_ESGOTADO: 'tempo_esgotado'
};

export function mensagemDoMotivo(motivo) {
  switch (motivo) {
    case MOTIVOS.NEGADO:
      return 'Não foi possível acessar sua localização. Você pode pesquisar um endereço manualmente.';
    case MOTIVOS.SEM_SUPORTE:
      return 'Seu navegador não oferece localização. Pesquise um endereço manualmente.';
    case MOTIVOS.TEMPO_ESGOTADO:
      return 'Demorou demais para achar sua localização. Tente novamente ou pesquise um endereço.';
    default:
      return 'Sua localização não está disponível agora. Pesquise um endereço manualmente.';
  }
}

/** Frase curta para mostrar ao lado do endereço. */
export function descreverPrecisao(metros) {
  if (metros == null) return 'precisão desconhecida';
  if (metros <= 30) return `precisão de ${Math.round(metros)} m`;
  if (metros <= 150) return `precisão de ${Math.round(metros)} m — confira no mapa`;
  if (metros < 1000) return `precisão de apenas ${Math.round(metros)} m — ajuste no mapa`;
  return `precisão de ${(metros / 1000).toFixed(1)} km — ajuste no mapa`;
}

export function precisaoRuim(metros) {
  return metros == null || metros > 100;
}

/**
 * Pega a posição atual insistindo por uma leitura boa.
 *
 * Em vez de aceitar a primeira resposta (que costuma vir do Wi-Fi, imprecisa),
 * ficamos ouvindo por alguns segundos: o GPS geralmente melhora a cada leitura.
 * Paramos assim que a precisão for boa o bastante, ou quando o tempo acabar.
 *
 * @param {object} opcoes
 * @param {number} opcoes.precisaoDesejada - metros. Para de esperar ao atingir.
 * @param {number} opcoes.tempoMaximo - milissegundos de espera total.
 */
export function obterPosicao({ precisaoDesejada = 30, tempoMaximo = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject({ motivo: MOTIVOS.SEM_SUPORTE });
    }

    let melhor = null;
    let finalizado = false;
    let idWatch = null;

    const finalizar = (erro) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(temporizador);
      if (idWatch !== null) navigator.geolocation.clearWatch(idWatch);
      if (melhor) return resolve(melhor);
      reject(erro || { motivo: MOTIVOS.INDISPONIVEL });
    };

    const temporizador = setTimeout(() => finalizar(), tempoMaximo);

    idWatch = navigator.geolocation.watchPosition(
      (pos) => {
        const leitura = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precisao: pos.coords.accuracy,
          quando: pos.timestamp
        };
        // Guarda só a leitura mais precisa que já vimos
        if (!melhor || leitura.precisao < melhor.precisao) melhor = leitura;
        if (melhor.precisao <= precisaoDesejada) finalizar();
      },
      (err) => {
        const mapa = {
          1: MOTIVOS.NEGADO,
          2: MOTIVOS.INDISPONIVEL,
          3: MOTIVOS.TEMPO_ESGOTADO
        };
        // Se já temos alguma leitura boa, o erro não importa mais
        finalizar({ motivo: mapa[err.code] || MOTIVOS.INDISPONIVEL });
      },
      { enableHighAccuracy: true, timeout: tempoMaximo, maximumAge: 0 }
    );
  });
}

/** Acompanha a posição enquanto a pessoa anda. Devolve função para parar. */
export function acompanharPosicao(aoAtualizar, aoErrar) {
  if (!('geolocation' in navigator)) {
    aoErrar?.({ motivo: MOTIVOS.SEM_SUPORTE });
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      aoAtualizar({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        precisao: pos.coords.accuracy,
        quando: pos.timestamp
      }),
    (err) => {
      const mapa = { 1: MOTIVOS.NEGADO, 2: MOTIVOS.INDISPONIVEL, 3: MOTIVOS.TEMPO_ESGOTADO };
      aoErrar?.({ motivo: mapa[err.code] || MOTIVOS.INDISPONIVEL });
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
  return () => navigator.geolocation.clearWatch(id);
}
