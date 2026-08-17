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

   BUG TESTADO E CORRIGIDO NESTA VERSÃO: "rua + número + cidade" podia
   devolver uma cidade ERRADA quando existe um bairro com nome parecido em
   outro lugar. Exemplo real testado: "Rua Augusta, 500, São Paulo" devolvia
   "Vila Augusta, Guarulhos" — o Photon (e o Nominatim, testado em paralelo)
   confundem o número com um bairro de nome parecido quando os dois aparecem
   juntos no texto. A mesma busca SEM o número acha a rua certa (Rua Augusta,
   Consolação, São Paulo) sempre. Por isso, quando o texto tem um número,
   fazemos as duas buscas (com e sem número) e usamos a segunda para
   validar/filtrar a primeira — ver `combinarComValidacao` abaixo.
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

/** Monta a URL de uma busca e devolve as features cruas do Photon. */
async function buscarBruto(texto, { limite, area, signal }) {
  const parametros = [`q=${encodeURIComponent(texto)}`, `limit=${limite}`, 'countrycode=BR'];
  if (area) {
    // Só prioriza resultados perto do que você está vendo no mapa — não exclui o resto.
    parametros.push(`lat=${((area.sul + area.norte) / 2).toFixed(5)}`);
    parametros.push(`lon=${((area.oeste + area.leste) / 2).toFixed(5)}`);
    parametros.push(`zoom=${estimarZoom(area)}`);
  }
  const resposta = await fetch(`${BASE}/api?${parametros.join('&')}`, {
    headers: { Accept: 'application/json' },
    signal
  });
  if (!resposta.ok) throw new Error('Falha na geocodificação');
  const dados = await resposta.json();
  return dados.features || [];
}

function cidadeDaFeature(feature) {
  const p = feature.properties || {};
  return (p.city || p.town || p.village || p.county || '').trim().toLowerCase();
}

/** O Photon às vezes devolve o mesmo trecho de rua como mais de um objeto do
    OSM (pedaços diferentes da mesma via) — sem número, os dois formatam pro
    mesmo texto. Evita mostrar a mesma sugestão repetida na lista. */
function semRepetir(lista) {
  const vistos = new Set();
  return lista.filter((r) => (vistos.has(r.nome) ? false : vistos.add(r.nome)));
}

/**
 * Cruza a busca "com número" com uma busca da mesma rua "sem número", pra
 * pegar o caso testado ao vivo nesta versão: "Rua Augusta, 500, São Paulo"
 * devolvia o bairro "Vila Augusta" em Guarulhos na frente da Rua Augusta
 * de verdade, porque o número junto ao texto confunde o Photon. A busca sem
 * número não tem esse problema (acha a rua certa direto) — usamos as cidades
 * que ELA encontrou como lista de confiança pra filtrar a busca com número.
 */
function combinarComValidacao(featuresComNumero, featuresSemNumero, numeroPedido, limite) {
  const cidadesConfiaveis = new Set(featuresSemNumero.map(cidadeDaFeature).filter(Boolean));

  // Só filtra quando a busca sem número achou algo — sem isso, uma busca sem
  // número vazia (rara) bloquearia a busca com número à toa.
  const comNumeroValidadas = cidadesConfiaveis.size
    ? featuresComNumero.filter((f) => cidadesConfiaveis.has(cidadeDaFeature(f)))
    : featuresComNumero;

  const resultadosComNumero = semRepetir(formatar(comNumeroValidadas, numeroPedido));
  const resultadosSemNumero = semRepetir(formatar(featuresSemNumero, numeroPedido));

  // A rua sem o número exato mapeado pode não ter aparecido (ou ter sido
  // descartada) na busca com número — completa com os resultados da busca
  // sem número, marcados como aproximados, evitando repetir a mesma rua.
  const jaIncluidos = new Set(resultadosComNumero.map((r) => r.nome));
  const complemento = resultadosSemNumero.filter((r) => !jaIncluidos.has(r.nome));

  return [...resultadosComNumero, ...complemento].slice(0, limite);
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

  // Cancela uma busca anterior ainda em andamento: sem isso, se a resposta
  // antiga chegar depois da nova (rede lenta), ela sobrescrevia a sugestão
  // certa com uma desatualizada.
  controladorBusca?.abort();
  controladorBusca = new AbortController();
  const { signal } = controladorBusca;

  const { rua, numero, resto } = separarNumero(termo);
  let resultados;

  try {
    if (numero) {
      // Pede mais candidatos do que o limite final pedido, porque a validação
      // cruzada abaixo pode descartar alguns antes do corte.
      const semNumeroTexto = [rua, resto].filter(Boolean).join(', ');
      const [comNumero, semNumero] = await Promise.all([
        buscarBruto(termo, { limite: Math.max(limite, 8), area, signal }),
        buscarBruto(semNumeroTexto, { limite: Math.max(limite, 6), area, signal })
      ]);
      resultados = combinarComValidacao(comNumero, semNumero, numero, limite);
    } else {
      const features = await buscarBruto(termo, { limite, area, signal });
      resultados = semRepetir(formatar(features, null));
    }
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
