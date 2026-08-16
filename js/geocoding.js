/* ============================================================================
   ROTA SEGURA — Geocodificação (endereço -> coordenadas e vice-versa)
   Serviço: Photon (Komoot), construído sobre dados do OpenStreetMap.
   Gratuito, sem chave de API, sem cadastro.

   POR QUE TROCAMOS O NOMINATIM PELO PHOTON:
   1. A política de uso do Nominatim proíbe explicitamente busca "enquanto
      digita" (autocomplete) — que é exatamente o que este app faz. Ao testar
      isso na prática, o próprio Nominatim bloqueou as requisições ("Access
      denied"). Numa rede compartilhada (Wi-Fi da escola, por exemplo), isso
      pode travar a busca para todo mundo atrás do mesmo IP.
      O Photon é feito exatamente para esse uso ("search as you type") e não
      tem essa restrição.
   2. Testado lado a lado com endereços reais, o Photon encontrou tudo que o
      Nominatim encontrava e, em vários casos — inclusive o exemplo
      "Rua Geógrafo Milton Santos" —, encontrou a RUA quando o Nominatim não
      achou nada.

   O QUE NÃO MUDA (e por quê):
   Nenhum serviço gratuito — Photon, Nominatim ou qualquer outro baseado no
   OpenStreetMap — tem TODOS os números de casa do Brasil mapeados. Fora de
   áreas centrais/bem mapeadas, é comum a rua existir no mapa mas o número
   exato não. Por isso, quando o número pedido não é encontrado, a busca
   ainda devolve a rua e MARCA o resultado como aproximado (campo
   `aproximado`), para a tela avisar você e deixar ajustar o pino arrastando
   — ver location-picker.js.
   ============================================================================ */

const BASE = 'https://photon.komoot.io';
const cache = new Map();
let controladorBusca = null;

/** Separa "Rua da Paz, 120 - Centro" em { rua: 'Rua da Paz', numero: '120', resto: 'Centro' } */
export function separarNumero(texto) {
  const limpo = texto.trim().replace(/\s+/g, ' ');

  // Formatos aceitos: "Rua X, 120" | "Rua X 120" | "Rua X, nº 120" | "Rua X, 120 - Bairro"
  const padrao = /^(.+?)[,\s]+(?:n[º°.]?\s*)?(\d{1,6})(?:\s*[-,]\s*(.*))?$/i;
  const achou = limpo.match(padrao);

  if (!achou) return { rua: limpo, numero: null, resto: '' };

  return {
    rua: achou[1].trim().replace(/[,\s]+$/, ''),
    numero: achou[2],
    resto: (achou[3] || '').trim()
  };
}

/** Zoom aproximado (estilo Leaflet) a partir do tamanho da área visível do mapa. */
function estimarZoom({ oeste, sul, leste, norte }) {
  const vao = Math.max(leste - oeste, norte - sul);
  if (vao < 0.01) return 16;
  if (vao < 0.05) return 14;
  if (vao < 0.2) return 12;
  if (vao < 1) return 10;
  return 7;
}

function formatar(features, numeroPedido) {
  return features
    .map((item) => {
      const p = item.properties || {};
      const [lng, lat] = item.geometry?.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const numero = p.housenumber || null;
      const rua = p.street || p.name || '';
      const bairro = p.district || p.locality || '';
      const cidade = p.city || p.town || p.village || p.county || '';

      const nome = [
        [rua, numero].filter(Boolean).join(', '),
        bairro,
        cidade,
        p.state
      ].filter(Boolean).join(', ') || p.name || 'Local sem nome';

      const curto = [
        [rua, numero].filter(Boolean).join(', '),
        bairro,
        cidade
      ].filter(Boolean).join(' — ') || nome;

      return {
        nome,
        curto,
        lat,
        lng,
        temNumero: Boolean(numero),
        // true = o número encontrado não bate com o número pedido (ou não existe);
        // o pino está na rua, não necessariamente na porta certa
        aproximado: Boolean(numeroPedido) && numero !== numeroPedido
      };
    })
    .filter(Boolean);
}

/**
 * Busca endereços pelo texto digitado.
 * @param {string} texto
 * @param {object} opcoes
 * @param {number} opcoes.limite
 * @param {object} opcoes.area - { oeste, sul, leste, norte } da tela do mapa (opcional)
 * @returns {Promise<Array<{nome, curto, lat, lng, temNumero, aproximado}>>}
 */
export async function buscarEndereco(texto, opcoes = {}) {
  // Compatibilidade: aceita buscarEndereco(texto, 5) como antes
  if (typeof opcoes === 'number') opcoes = { limite: opcoes };
  const { limite = 5, area = null } = opcoes;

  const termo = texto.trim();
  if (termo.length < 3) return [];

  const chaveArea = area ? `${area.oeste.toFixed(2)},${area.sul.toFixed(2)}` : 'br';
  const chave = `b:${termo}:${limite}:${chaveArea}`;
  if (cache.has(chave)) return cache.get(chave);

  const parametros = [`q=${encodeURIComponent(termo)}`, `limit=${limite}`, 'countrycode=BR'];
  if (area) {
    // Só prioriza resultados perto do que você está vendo no mapa — não exclui o resto.
    parametros.push(`lat=${((area.sul + area.norte) / 2).toFixed(5)}`);
    parametros.push(`lon=${((area.oeste + area.leste) / 2).toFixed(5)}`);
    parametros.push(`zoom=${estimarZoom(area)}`);
  }

  // Cancela uma busca anterior ainda em andamento: sem isso, se a resposta
  // antiga chegar depois da nova (rede lenta), ela sobrescrevia a sugestão
  // certa com uma desatualizada.
  controladorBusca?.abort();
  controladorBusca = new AbortController();

  // Usado só para conferir se o número encontrado bate com o pedido
  // (o Photon já entende "rua, número" sozinho — não precisa de campos separados).
  const { numero } = separarNumero(termo);
  let resultados;

  try {
    const resposta = await fetch(`${BASE}/api?${parametros.join('&')}`, {
      headers: { Accept: 'application/json' },
      signal: controladorBusca.signal
    });
    if (!resposta.ok) throw new Error('Falha na geocodificação');
    const dados = await resposta.json();
    resultados = formatar(dados.features || [], numero);
  } catch (erro) {
    if (erro.name === 'AbortError') return []; // uma busca mais nova já está em andamento
    throw erro;
  }

  // Não reordenamos por "tem número exato": o Photon já leva em conta a
  // proximidade (via lat/lon acima) e a relevância de cada resultado. Testamos
  // colocar sempre o número exato em primeiro lugar e o efeito foi ruim —
  // um resultado numerado a 500 km passava na frente da rua certa que
  // aparecia bem na tela, só por não ter o número mapeado.

  cache.set(chave, resultados);
  return resultados;
}

/** Converte coordenadas em um endereço legível. */
export async function enderecoDeCoordenadas(lat, lng) {
  const chave = `r:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  if (cache.has(chave)) return cache.get(chave);

  const url = `${BASE}/reverse?lat=${lat}&lon=${lng}`;
  try {
    const resposta = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resposta.ok) throw new Error('falha');
    const dados = await resposta.json();
    const p = dados.features?.[0]?.properties || {};
    const partes = [
      [p.street, p.housenumber].filter(Boolean).join(', '),
      p.district || p.locality,
      p.city || p.town || p.village
    ].filter(Boolean);
    const endereco = partes.join(' — ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cache.set(chave, endereco);
    return endereco;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
