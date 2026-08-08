/* ============================================================
   ROTA SEGURA — geocode.js
   Geocodificação de endereço (texto → latitude/longitude) usando
   a API pública do Nominatim (OpenStreetMap). Gratuita, sem chave,
   mas com limite de uso educado: no máximo 1 requisição/segundo e
   sempre com debounce enquanto a usuária digita.
   ============================================================ */

let ultimoControlador = null;

/**
 * Busca coordenadas para um endereço textual.
 * Retorna { lat, lng, enderecoEncontrado } ou null se nada for achado.
 */
export async function geocodificarEndereco(consulta) {
  const texto = (consulta || '').trim();
  if (texto.length < 5) return null;

  // Cancela uma busca anterior ainda em andamento (evita respostas
  // fora de ordem quando a usuária continua digitando).
  if (ultimoControlador) ultimoControlador.abort();
  ultimoControlador = new AbortController();

  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(texto)}`;

  try {
    const resposta = await fetch(url, {
      signal: ultimoControlador.signal,
      headers: { 'Accept-Language': 'pt-BR' }
    });
    if (!resposta.ok) return null;

    const resultados = await resposta.json();
    if (!resultados.length) return null;

    const primeiro = resultados[0];
    return {
      lat: parseFloat(primeiro.lat),
      lng: parseFloat(primeiro.lon),
      enderecoEncontrado: primeiro.display_name
    };
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.warn('[Rota Segura] Falha ao geocodificar endereço:', err);
    return null;
  }
}

/** Cria uma versão "com espera" (debounce) de uma função. */
export function comDebounce(fn, atrasoMs = 700) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), atrasoMs);
  };
}
