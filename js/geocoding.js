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

   ENDEREÇOS DO RIO DE JANEIRO: além do Photon, este arquivo também consulta
   a tabela public.enderecos_rio (dado do Censo 2022 do IBGE — CNEFE, número
   e coordenada reais, coletados porta a porta). Quando o endereço buscado
   está nessa base, o resultado vem primeiro e SEM aviso de "aproximado" —
   é dado de censo real, não estimativa. Fora do Rio (ou pra endereços muito
   novos, depois do Censo), a busca cai no Photon do mesmo jeito de sempre.
   ============================================================================ */

import { distanciaMetros } from './ui.js';
import { supabase } from './supabase.js';

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

/* ============================================================================
   BASE LOCAL: enderecos_rio (CNEFE / Censo 2022 do IBGE)
   ============================================================================ */

const TIPOS_LOGRADOURO = [
  'rua', 'av', 'avenida', 'travessa', 'alameda', 'estrada', 'rodovia',
  'praça', 'praca', 'largo', 'viela', 'ladeira', 'via', 'rod'
];

/** Remove acentos ("Geógrafo" -> "Geografo") — o CNEFE guarda nome de rua
    sem acentuação nenhuma (é assim que o IBGE já distribui o dado), então
    uma busca com acento (do jeito que qualquer pessoa digita em português)
    nunca bateria com o texto salvo sem essa normalização. */
function semAcento(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Separa "Rua Iranduba" em { tipo: 'Rua', nome: 'Iranduba' } — a tabela
    enderecos_rio guarda tipo e nome do logradouro em colunas separadas. Se
    a primeira palavra não for um tipo reconhecido, assume que o texto
    inteiro é o nome (não atrapalha a busca, só não separa o tipo). */
function separarTipoDeLogradouro(texto) {
  const partes = texto.trim().split(/\s+/);
  const primeira = semAcento(partes[0] || '').toLowerCase().replace(/\.$/, '');
  if (partes.length > 1 && TIPOS_LOGRADOURO.includes(primeira)) {
    return { tipo: partes[0], nome: partes.slice(1).join(' ') };
  }
  return { tipo: null, nome: texto.trim() };
}

/** Uma consulta de "contém" (não só "começa com") em enderecos_rio — nomes
    de rua no Brasil costumam ter um título/honorífico opcional na frente
    ("Rua MAJOR Fulano", "Rua DOUTOR Beltrano"), e não dá pra saber se quem
    está buscando vai digitar esse título ou não. "Contém" resolve o caso
    mais comum (pessoa não digita o título, mas ele existe no dado); ver
    buscarNoCnefeRio para o caso contrário (título digitado que não existe
    no dado do Censo). */
async function consultarEnderecosRio(nomeBusca, numero, limite) {
  let consulta = supabase
    .from('enderecos_rio')
    .select('tipo_logradouro,nome_logradouro,numero,bairro,cep,lat,lng')
    .ilike('nome_logradouro', `%${nomeBusca}%`);
  if (numero) consulta = consulta.eq('numero', numero);
  consulta = consulta.limit(limite);
  const { data, error } = await consulta;
  return error || !data ? [] : data;
}

/** Busca na base de endereços do Rio de Janeiro (dado real do Censo 2022,
    não estimativa) — roda em paralelo com o Photon em buscarEndereco(). */
async function buscarNoCnefeRio(ruaTexto, numero, limite) {
  if (!ruaTexto) return [];
  const { nome } = separarTipoDeLogradouro(ruaTexto);
  const nomeLimpo = semAcento(nome || '').trim();
  if (!nomeLimpo || nomeLimpo.length < 3) return [];

  try {
    let linhas = await consultarEnderecosRio(nomeLimpo, numero, limite);

    // Se não achou nada e o nome tem mais de uma palavra, a primeira pode
    // ser um título que a pessoa digitou mas o Censo não registrou pra essa
    // rua (ex.: buscar "Geógrafo Milton Santos" quando o dado só tem "Milton
    // Santos") — tenta de novo sem a primeira palavra antes de desistir.
    if (!linhas.length) {
      const palavras = nomeLimpo.split(/\s+/);
      if (palavras.length > 1) {
        linhas = await consultarEnderecosRio(palavras.slice(1).join(' '), numero, limite);
      }
    }
    if (!linhas.length) return [];

    return linhas.map((r) => {
      const ruaCompleta = [r.tipo_logradouro, r.nome_logradouro].filter(Boolean).join(' ');
      const nomeCompleto = [
        [ruaCompleta, r.numero].filter(Boolean).join(', '),
        r.bairro,
        'Rio de Janeiro',
        'RJ',
        r.cep ? `CEP ${r.cep}` : null
      ].filter(Boolean).join(', ');
      const curto = [
        [ruaCompleta, r.numero].filter(Boolean).join(', '),
        r.bairro,
        'Rio de Janeiro'
      ].filter(Boolean).join(' — ');

      return {
        nome: nomeCompleto,
        curto,
        lat: Number(r.lat),
        lng: Number(r.lng),
        bairro: r.bairro || null,
        cidade: 'Rio de Janeiro',
        cep: r.cep || null,
        temNumero: true,
        aproximado: false // dado de censo real, não estimativa
      };
    });
  } catch {
    // A busca em enderecos_rio nunca pode derrubar a busca inteira — se
    // falhar (rede, tabela ainda não criada etc.), simplesmente não
    // contribui candidatos, e o Photon continua funcionando normalmente.
    return [];
  }
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
      const cep = p.postcode || null;

      const nome = [
        [rua, numero].filter(Boolean).join(', '),
        bairro,
        cidade,
        p.state,
        cep ? `CEP ${cep}` : null
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
        bairro: bairro || null,
        cidade: cidade || null,
        cep,
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
function combinarComValidacao(featuresComNumero, featuresSemNumero, numeroPedido, limite, centroArea) {
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
  let complemento = resultadosSemNumero.filter((r) => !jaIncluidos.has(r.nome));

  // Uma rua comprida pode existir como vários trechos separados do OSM,
  // cada um num bairro (ou até cidade) diferente — sem o número exato pra
  // desempatar, o Photon pode devolver primeiro um trecho longe de onde
  // você está, mesmo que outro trecho da MESMA rua esteja bem mais perto.
  // Quando sabemos o centro da área visível no mapa, usamos isso pra
  // ordenar os trechos aproximados do mais perto pro mais longe — em vez de
  // aceitar a ordem de relevância genérica do serviço, que não sabe onde
  // você está.
  if (centroArea && complemento.length > 1) {
    complemento = [...complemento].sort(
      (a, b) => distanciaMetros(centroArea.lat, centroArea.lng, a.lat, a.lng)
        - distanciaMetros(centroArea.lat, centroArea.lng, b.lat, b.lng)
    );
  }

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

  // enderecos_rio roda sempre em paralelo com o Photon (nunca bloqueia nem
  // atrasa a busca — se não achar nada ou a tabela ainda não existir, some
  // sozinho e o Photon continua funcionando normalmente).
  const buscaCnefe = buscarNoCnefeRio(rua, numero, limite);

  let resultadosPhoton;
  try {
    if (numero) {
      // Pede mais candidatos do que o limite final pedido, porque a validação
      // cruzada abaixo pode descartar alguns antes do corte.
      const semNumeroTexto = [rua, resto].filter(Boolean).join(', ');
      const [comNumero, semNumero] = await Promise.all([
        buscarBruto(termo, { limite: Math.max(limite, 8), area, signal }),
        buscarBruto(semNumeroTexto, { limite: Math.max(limite, 6), area, signal })
      ]);
      const centroArea = area ? { lat: (area.sul + area.norte) / 2, lng: (area.oeste + area.leste) / 2 } : null;
      resultadosPhoton = combinarComValidacao(comNumero, semNumero, numero, limite, centroArea);
    } else {
      const features = await buscarBruto(termo, { limite, area, signal });
      resultadosPhoton = semRepetir(formatar(features, null));
    }
  } catch (erro) {
    if (erro.name === 'AbortError') return []; // uma busca mais nova já está em andamento
    throw erro;
  }

  // Não reordenamos os resultados do Photon por "tem número exato": ele já
  // leva em conta a proximidade (via lat/lon acima) e a relevância de cada
  // resultado. Testamos colocar sempre o número exato em primeiro lugar e o
  // efeito foi ruim — um resultado numerado a 500 km passava na frente da
  // rua certa que aparecia bem na tela, só por não ter o número mapeado.
  //
  // enderecos_rio é diferente: quando ele acha o endereço, é dado de censo
  // real (não estimativa), então vem sempre primeiro — completado pelo
  // Photon, sem repetir a mesma rua duas vezes.
  const resultadosCnefe = await buscaCnefe;
  const jaVistos = new Set(resultadosCnefe.map((r) => r.nome));
  const resultados = [
    ...resultadosCnefe,
    ...resultadosPhoton.filter((r) => !jaVistos.has(r.nome))
  ].slice(0, limite);

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
