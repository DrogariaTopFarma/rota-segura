/* ============================================================================
   ROTA SEGURA — Geocodificação (endereço -> coordenadas e vice-versa)
   Serviço: Nominatim, do OpenStreetMap. Gratuito, sem chave de API.

   POR QUE ESTE ARQUIVO MUDOU:
   A busca não achava número, só rua. Dois motivos:

   1. O OpenStreetMap não tem TODOS os números de casa do Brasil mapeados.
      Nenhum serviço gratuito tem. Quando o número não existe na base,
      a busca com número simplesmente não devolve nada.
   2. A busca era feita como texto solto e sem dizer ao Nominatim em que
      região procurar, então "Rua da Paz, 120" competia com ruas de mesmo
      nome do país inteiro.

   O que fazemos agora, em cascata:
   Tentativa 1 - busca estruturada (rua+número separados da cidade)
   Tentativa 2 - busca em texto livre
   Tentativa 3 - busca só a rua, sem o número, e MARCA o resultado como
                 aproximado, para a tela avisar você e deixar ajustar o pino.

   Também passamos a "viewbox": a área que você está vendo no mapa. Assim os
   resultados perto de você aparecem primeiro.
   ============================================================================ */

const BASE = 'https://nominatim.openstreetmap.org';
const cache = new Map();

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

async function chamar(parametros) {
  const url = `${BASE}/${parametros.rota}?${parametros.query}`;
  const resposta = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resposta.ok) throw new Error('Falha na geocodificação');
  return resposta.json();
}

function formatar(itens, { aproximado = false } = {}) {
  return itens.map((item) => {
    const a = item.address || {};
    const numero = a.house_number || null;
    const rua = a.road || a.pedestrian || a.footway || '';
    const bairro = a.suburb || a.neighbourhood || a.city_district || '';
    const cidade = a.city || a.town || a.village || a.municipality || '';

    const curto = [
      [rua, numero].filter(Boolean).join(', '),
      bairro,
      cidade
    ].filter(Boolean).join(' — ') || item.display_name;

    return {
      nome: item.display_name,
      curto,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      temNumero: Boolean(numero),
      // true = o número pedido não foi encontrado; o pino está na rua, não na porta
      aproximado: aproximado && !numero
    };
  });
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

  const comum =
    `format=jsonv2&limit=${limite}&countrycodes=br` +
    `&addressdetails=1&accept-language=pt-BR` +
    (area
      ? `&viewbox=${area.oeste},${area.norte},${area.leste},${area.sul}&bounded=0`
      : '');

  const { rua, numero, resto } = separarNumero(termo);
  let resultados = [];

  // ---- Tentativa 1: busca estruturada (só quando há número) ----
  if (numero) {
    try {
      const partes = [`street=${encodeURIComponent(`${numero} ${rua}`)}`];
      if (resto) partes.push(`city=${encodeURIComponent(resto)}`);
      const dados = await chamar({ rota: 'search', query: `${comum}&${partes.join('&')}` });
      resultados = formatar(dados);
    } catch { /* segue para a próxima tentativa */ }
  }

  // ---- Tentativa 2: texto livre, do jeito que a pessoa digitou ----
  if (!resultados.length) {
    const dados = await chamar({ rota: 'search', query: `${comum}&q=${encodeURIComponent(termo)}` });
    resultados = formatar(dados);
  }

  // ---- Tentativa 3: sem o número, marcando como aproximado ----
  if (!resultados.length && numero) {
    const semNumero = [rua, resto].filter(Boolean).join(', ');
    const dados = await chamar({ rota: 'search', query: `${comum}&q=${encodeURIComponent(semNumero)}` });
    resultados = formatar(dados, { aproximado: true });
  }

  // Se pediram número e nenhum resultado tem número, todos são aproximados
  if (numero && resultados.length && !resultados.some((r) => r.temNumero)) {
    resultados = resultados.map((r) => ({ ...r, aproximado: true }));
  }

  cache.set(chave, resultados);
  return resultados;
}

/** Converte coordenadas em um endereço legível. */
export async function enderecoDeCoordenadas(lat, lng) {
  const chave = `r:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  if (cache.has(chave)) return cache.get(chave);

  const url = `${BASE}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=pt-BR`;
  try {
    const resposta = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resposta.ok) throw new Error('falha');
    const dados = await resposta.json();
    const a = dados.address || {};
    const partes = [
      [a.road, a.house_number].filter(Boolean).join(', '),
      a.suburb || a.neighbourhood,
      a.city || a.town || a.village
    ].filter(Boolean);
    const endereco = partes.join(' — ') || dados.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cache.set(chave, endereco);
    return endereco;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
