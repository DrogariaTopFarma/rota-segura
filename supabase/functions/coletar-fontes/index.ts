// ============================================================================
// ROTA SEGURA — Edge Function: coletar-fontes
// ----------------------------------------------------------------------------
// Coleta notícias públicas do Rio de Janeiro (hoje: RSS do G1 Rio), pede pra
// uma IA (Google Gemini) classificar/estruturar cada uma, valida que é
// realmente do RJ, cruza com relatos já existentes de usuárias e com outras
// notícias já coletadas, calcula uma pontuação de confiança e só então grava
// em `external_incidents`. Nunca publica nada sozinha sem essas checagens —
// ver sql/schema.sql (tabela 16) e COMO_CONFIGURAR_COLETA_RJ.md.
//
// REGRA MAIS IMPORTANTE DESTE ARQUIVO: a IA NUNCA é a fonte da verdade.
// Ela só interpreta o texto da notícia — quem decide se algo é do RJ, se é
// evento ou estatística, e a pontuação final de confiança é código nosso,
// não a palavra da IA. Se a IA disser algo que o texto não sustenta, isso é
// um bug a corrigir, nunca "confia porque a IA disse".
//
// COMO PUBLICAR: mesmo processo de calcular-rota — copie e cole este arquivo
// inteiro no editor do Dashboard do Supabase (Edge Functions -> Deploy a new
// function -> Via Editor, nome da função: "coletar-fontes"). Passo a passo
// completo em COMO_CONFIGURAR_COLETA_RJ.md.
//
// COMO É DISPARADA: POST sem corpo, com os cabeçalhos
//   apikey: <chave secreta do Supabase, sb_secret_...>   (exigido pelo
//           próprio Supabase pra deixar a chamada passar até a função)
//   authorization: Bearer <chave secreta do Supabase, sb_secret_...>  (idem)
//   x-coleta-secret: <COLETA_SECRET>   (nossa senha própria — é ESTA que a
//           função de fato confere abaixo, não a de cima)
// O agendamento automático (.github/workflows/coletar-fontes.yml) já manda
// tudo isso sozinho — você só chama manualmente pra testar.
//
// SECRETS NECESSÁRIOS (Dashboard -> Edge Functions -> coletar-fontes -> Secrets):
//   GEMINI_API_KEY — sua chave do Google AI Studio (README_AI_SETUP.md)
//   COLETA_SECRET  — uma senha inventada por você, só pra esta função aceitar
//                    só chamadas autorizadas (não é a anon key nem a service
//                    role key do Supabase — é uma senha à parte, sua)
//   FOGOCRUZADO_EMAIL / FOGOCRUZADO_PASSWORD — opcionais: só necessários se
//                    você tiver conta na API do Instituto Fogo Cruzado (ver
//                    COMO_CONFIGURAR_COLETA_RJ.md). Sem eles, essa fonte
//                    específica fica indisponível, mas as outras continuam
//                    funcionando normalmente.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos automaticamente em
// toda Edge Function do Supabase — não precisa (nem consegue) criar esses
// dois manualmente: o Supabase reserva o prefixo "SUPABASE_" e recusa
// qualquer secret criado com esse nome.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

/* ============================================================================
   1. CONFIGURAÇÃO — pesos e limites, tudo ajustável aqui, num lugar só.
   ============================================================================ */
const MAX_ITENS_POR_EXECUCAO = 20; // nunca processa mais que isso por chamada (item 36 do pedido)
const RAIO_DEDUP_METROS = 600;     // distância máxima pra considerar "mesmo lugar"
const JANELA_DEDUP_HORAS = 72;     // janela de tempo pra considerar "mesma época"
const TENTATIVAS_IA = 3;           // retry com backoff em erro passageiro da IA

// Validade por categoria (item 28 do pedido: nada fica "ativo" pra sempre).
const VALIDADE_PADRAO_HORAS = {
  acidente: 12,
  bloqueio: 24,
  obra: 24 * 30,
  assalto: 24 * 3,
  assedio_verbal: 24 * 3,
  assedio_fisico: 24 * 3,
  perseguicao: 24,
  rua_pouco_iluminada: 24 * 30,
  local_isolado: 24 * 30,
  tiroteio: 24 * 3,
  geral: 24 * 7,
  outro: 24 * 3
};

// Pesos da fórmula de confiança (item 24 do pedido) — documentados e fáceis
// de reajustar. NÃO inclui peso de "confirmação de usuária" porque esse
// mecanismo não existe em `reports` hoje (só existe curtida em `posts`, que é
// outra coisa — ver plano). Quando existir, entra aqui como mais um peso.
const PESO_FONTE = { official_data: 4, public_source: 2 };
const PESO_LOCALIZACAO = { coordenada: 3, endereco: 2, bairro: 1, nenhuma: 0 };
const PESO_TEMPORAL = { data_exata: 2, so_publicacao: 1, nenhuma: 0 };
const PESO_POR_FONTE_EXTRA = 2; // por evidência independente além da primeira
const PESO_CONTRADICAO = 4;
const PESO_IDADE_POR_DIA = 0.3;
const LIMIAR_ALTA = 7;
const LIMIAR_MEDIA = 3;

/* ============================================================================
   2. MUNICÍPIOS DO RIO DE JANEIRO (92 — fonte: IBGE) — a validação geográfica
      de verdade acontece EM CIMA DISSO, nunca só confiando na palavra da IA
      (item 1 do pedido: "não confie apenas na IA para determinar a
      localização"). Nomes sem acento e minúsculos, pra comparar sem depender
      de a IA/o texto escrever com acentuação exata.
   ============================================================================ */
const MUNICIPIOS_RJ = [
  'angra dos reis', 'aperibe', 'araruama', 'areal', 'armacao dos buzios',
  'arraial do cabo', 'barra do pirai', 'barra mansa', 'belford roxo',
  'bom jardim', 'bom jesus do itabapoana', 'cabo frio', 'cachoeiras de macacu',
  'cambuci', 'campos dos goytacazes', 'cantagalo', 'carapebus',
  'cardoso moreira', 'carmo', 'casimiro de abreu',
  'comendador levy gasparian', 'conceicao de macabu', 'cordeiro',
  'duas barras', 'duque de caxias', 'engenheiro paulo de frontin',
  'guapimirim', 'iguaba grande', 'itaborai', 'itaguai', 'italva', 'itaocara',
  'itaperuna', 'itatiaia', 'japeri', 'laje do muriae', 'macae', 'macuco',
  'mage', 'mangaratiba', 'marica', 'mendes', 'mesquita', 'miguel pereira',
  'miracema', 'natividade', 'nilopolis', 'niteroi', 'nova friburgo',
  'nova iguacu', 'paracambi', 'paraiba do sul', 'paraty', 'paty do alferes',
  'petropolis', 'pinheiral', 'pirai', 'porciuncula', 'porto real', 'quatis',
  'queimados', 'quissama', 'resende', 'rio bonito', 'rio claro',
  'rio das flores', 'rio das ostras', 'rio de janeiro',
  'santa maria madalena', 'santo antonio de padua', 'sao fidelis',
  'sao francisco de itabapoana', 'sao goncalo', 'sao joao da barra',
  'sao joao de meriti', 'sao jose de uba', 'sao jose do vale do rio preto',
  'sao pedro da aldeia', 'sao sebastiao do alto', 'sapucaia', 'saquarema',
  'seropedica', 'silva jardim', 'sumidouro', 'tangua', 'teresopolis',
  'trajano de moraes', 'tres rios', 'valenca', 'varre-sai', 'vassouras',
  'volta redonda'
];

// Bounding box do ESTADO do Rio de Janeiro — só usado quando existe
// coordenada, como confirmação adicional (item 17 do pedido: "se o geocoder
// retornar localização fora do RJ, rejeitar"). Nunca é o único critério.
const RJ_BBOX = { sul: -23.4, norte: -20.75, oeste: -44.95, leste: -40.9 };

/* ============================================================================
   3. UTILITÁRIOS PUROS (sem Deno.*, testáveis isoladamente com dado simulado)
   ============================================================================ */

export function semAcento(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Pré-filtro barato, ANTES de gastar uma chamada de IA: o texto sequer
    menciona algum município do RJ? Não é a validação final — essa acontece
    depois, em cima do que a própria IA extraiu (cidadeEhDoRJ). É só pra não
    gastar IA à toa com notícia que claramente não é sobre aqui. */
export function textoMencionaMunicipioRJ(texto) {
  const normalizado = semAcento(texto).toLowerCase();
  return MUNICIPIOS_RJ.find((m) => normalizado.includes(m)) || null;
}

/** Validação de verdade: a cidade que a IA devolveu é mesmo um município do
    RJ? Comparação EXATA (depois de normalizar), não "contém" — pra não
    confundir "Rio de Janeiro" com "Rio Branco", nem aceitar bairro da
    capital ("Barra da Tijuca") como se fosse outro município ("Barra
    Mansa"). */
export function cidadeEhDoRJ(cidade) {
  if (!cidade) return false;
  const normalizada = semAcento(cidade).toLowerCase().trim();
  return MUNICIPIOS_RJ.includes(normalizada);
}

export function coordenadaEstaNoRJ(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return lat >= RJ_BBOX.sul && lat <= RJ_BBOX.norte && lng >= RJ_BBOX.oeste && lng <= RJ_BBOX.leste;
}

/** Mesma fórmula (haversine) usada no resto do site (js/ui.js,
    distanciaMetros) — repetida aqui porque a Edge Function roda isolada em
    Deno, sem acesso aos módulos do front-end. */
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** EVENT vs STATISTIC (itens 7/8 do pedido), verificado no texto BRUTO,
    antes/junto da resposta da IA — número agregado com palavra de período
    ("no último mês", "por cem mil habitantes") é estatística, nunca vira um
    marcador individual no mapa. Serve de reforço quando a IA erra o
    eventType, e é testável sem chamar IA nenhuma. */
export function pareceEstatistica(texto) {
  const normalizado = semAcento(texto || '').toLowerCase();
  const padroes = [
    /\d+\s*(ocorrenc|casos|registros|crimes|acidentes)/,
    /(no ultimo|nos ultimos|durante o|ao longo do)\s+(mes|ano|semestre|trimestre)/,
    /por cem mil habitantes/,
    /taxa de/,
    /comparad[oa] a|em relacao ao ano anterior/
  ];
  return padroes.some((p) => p.test(normalizado));
}

export function precisaoLocalizacao({ lat, lng, address, neighborhood }) {
  if (typeof lat === 'number' && typeof lng === 'number') return 'coordenada';
  if (address) return 'endereco';
  if (neighborhood) return 'bairro';
  return 'nenhuma';
}
export function precisaoTemporal({ occurred_at, published_at }) {
  if (occurred_at) return 'data_exata';
  if (published_at) return 'so_publicacao';
  return 'nenhuma';
}

/** Fórmula de confiança (item 24 do pedido) — pesos configuráveis lá em
    cima. `evidenciasUnicas` conta o próprio item + quantas fontes
    independentes (não duplicadas entre si) apontam pro mesmo acontecimento. */
export function calcularConfianca({
  sourceType, lat, lng, address, neighborhood, occurred_at, published_at,
  evidenciasUnicas = 1, temContradicao = false, idadeDias = 0
}) {
  let pontos = PESO_FONTE[sourceType] ?? 0;
  pontos += PESO_LOCALIZACAO[precisaoLocalizacao({ lat, lng, address, neighborhood })];
  pontos += PESO_TEMPORAL[precisaoTemporal({ occurred_at, published_at })];
  pontos += PESO_POR_FONTE_EXTRA * Math.max(0, evidenciasUnicas - 1);
  if (temContradicao) pontos -= PESO_CONTRADICAO;
  pontos -= PESO_IDADE_POR_DIA * Math.max(0, idadeDias);
  return Math.max(0, Math.round(pontos * 10) / 10);
}

export function nivelDeConfianca(pontos) {
  if (pontos >= LIMIAR_ALTA) return 'alta';
  if (pontos >= LIMIAR_MEDIA) return 'media';
  return 'baixa';
}

/** Deduplicação (itens 20/21 do pedido): dois itens parecem o mesmo
    acontecimento quando têm a MESMA categoria, estão perto (raio de
    RAIO_DEDUP_METROS, ou mesmo bairro quando não há coordenada) e estão na
    mesma janela de tempo. Sem NLP sofisticado — é geografia + tempo +
    categoria, o mesmo tripé descrito no pedido. */
export function pareceMesmoAcontecimento(a, b) {
  if (a.category !== b.category) return false;

  if (typeof a.lat === 'number' && typeof a.lng === 'number' && typeof b.lat === 'number' && typeof b.lng === 'number') {
    if (distanciaMetros(a.lat, a.lng, b.lat, b.lng) > RAIO_DEDUP_METROS) return false;
  } else if (a.neighborhood && b.neighborhood) {
    if (semAcento(a.neighborhood).toLowerCase() !== semAcento(b.neighborhood).toLowerCase()) return false;
  } else {
    return false; // sem localização comparável, não assume que é o mesmo
  }

  const dataA = a.occurred_at || a.published_at;
  const dataB = b.occurred_at || b.published_at;
  if (!dataA || !dataB) return false;
  const diffHoras = Math.abs(new Date(dataA).getTime() - new Date(dataB).getTime()) / 36e5;
  return diffHoras <= JANELA_DEDUP_HORAS;
}

/** Contradição (item 26 do pedido): mesma categoria e mesmo bairro, mas
    horário incompatível — sinal de duas versões conflitantes da mesma
    história, não uma confirmando a outra. Marca `disputed`, nunca soma as
    duas como se fossem confirmação. */
export function saoContraditorios(a, b) {
  if (a.category !== b.category) return false;
  const localA = semAcento(a.neighborhood || '').toLowerCase();
  const localB = semAcento(b.neighborhood || '').toLowerCase();
  if (!localA || localA !== localB) return false;
  const dataA = a.occurred_at || a.published_at;
  const dataB = b.occurred_at || b.published_at;
  if (!dataA || !dataB) return false;
  const diffHoras = Math.abs(new Date(dataA).getTime() - new Date(dataB).getTime()) / 36e5;
  return diffHoras > 6 && diffHoras <= JANELA_DEDUP_HORAS;
}

export function expiraEm(category, aPartirDe) {
  const base = aPartirDe instanceof Date && !Number.isNaN(aPartirDe.getTime()) ? aPartirDe : new Date();
  const horas = VALIDADE_PADRAO_HORAS[category] ?? VALIDADE_PADRAO_HORAS.outro;
  return new Date(base.getTime() + horas * 3600 * 1000).toISOString();
}

/* ============================================================================
   4. FONTE: RSS de notícias do G1 Rio (DataSource — "public_source")
      Pra acrescentar outra fonte no futuro: escreva outra função no mesmo
      formato (devolve um array de {tituloBruto, resumoBruto, url, idFonte,
      publicadoEm}) e acrescente um item em FONTES, lá embaixo — nada mais no
      resto do arquivo precisa mudar.
   ============================================================================ */

function extrairTagXML(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}
function limparCDATA(texto) {
  if (!texto) return texto;
  const m = texto.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (m ? m[1] : texto).trim();
}
function limparHtml(texto) {
  return (texto || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** RSS 2.0 é simples o bastante pra não precisar de uma biblioteca de XML —
    um parser de verdade seria mais robusto, mas adicionaria uma dependência
    externa só pra isso. Se o feed mudar de formato, esta função só deixa de
    achar itens (devolve array vazio) em vez de quebrar a coleta inteira. */
export function extrairItensRSS(xml, limite = MAX_ITENS_POR_EXECUCAO) {
  const blocos = (xml || '').split('<item>').slice(1);
  const itens = [];
  for (const bloco of blocos.slice(0, limite)) {
    const fim = bloco.indexOf('</item>');
    const corpo = fim === -1 ? bloco : bloco.slice(0, fim);
    const titulo = limparCDATA(extrairTagXML(corpo, 'title'));
    const link = limparCDATA(extrairTagXML(corpo, 'link'));
    const guid = limparCDATA(extrairTagXML(corpo, 'guid')) || link;
    const pubDateBruta = extrairTagXML(corpo, 'pubDate');
    const descricaoBruta = limparCDATA(extrairTagXML(corpo, 'description'));
    if (!titulo || !guid) continue;
    const publicadoEm = pubDateBruta && !Number.isNaN(Date.parse(pubDateBruta))
      ? new Date(pubDateBruta).toISOString()
      : null;
    itens.push({
      tituloBruto: titulo,
      resumoBruto: limparHtml(descricaoBruta || ''),
      url: link,
      idFonte: guid,
      publicadoEm
    });
  }
  return itens;
}

async function coletarG1Rio() {
  const resposta = await fetch('http://g1.globo.com/dynamo/rio-de-janeiro/rss2.xml');
  if (!resposta.ok) throw new Error(`G1 RSS respondeu ${resposta.status}`);
  const xml = await resposta.text();
  return extrairItensRSS(xml);
}

/** Feed do G1 já filtrado por editoria de trânsito (testado ao vivo: só traz
    acidente/bloqueio de via, sem a mistura de assuntos do feed geral acima).
    Outras editorias tentadas (policia, violencia, seguranca, criminalidade)
    voltam vazias — o G1 não expõe RSS próprio pra ocorrência policial no Rio,
    só pra trânsito. */
async function coletarG1RioTransito() {
  const resposta = await fetch('http://g1.globo.com/dynamo/rio-de-janeiro/transito/rss2.xml');
  if (!resposta.ok) throw new Error(`G1 RSS (trânsito) respondeu ${resposta.status}`);
  const xml = await resposta.text();
  return extrairItensRSS(xml);
}

/** Instituto Fogo Cruzado (ONG) — mapeia tiroteios/disparos de arma de fogo
    no RJ desde 2016, com checagem humana por uma equipe de analistas antes
    de publicar (não é post cru de rede social). Diferente do RSS do G1, cada
    ocorrência já vem com coordenada exata, data exata e bairro estruturado
    — por isso o item devolvido aqui carrega `coordenadaConhecida` e
    `ocorridoEmConhecido`, que `processarItem` usa no lugar de geocodificar/
    adivinhar (evita a perda de precisão de recair no Photon).

    Classificado como `public_source` (não `official_data`) porque é uma ONG,
    não um órgão de governo — mesmo com checagem humana, mantém o mesmo peso
    de confiança de base do G1 nesta versão; reavalie se fizer sentido criar
    um peso à parte.

    Não tem cadastro público automático — pediu acesso por e-mail em
    contato@fogocruzado.org.br. Credenciais vêm dos secrets
    FOGOCRUZADO_EMAIL/FOGOCRUZADO_PASSWORD (nunca hardcoded aqui). Sem esses
    secrets configurados, esta fonte fica indisponível mas não derruba as
    outras (mesmo tratamento de qualquer fonte fora do ar). */
async function coletarFogoCruzado() {
  const email = Deno.env.get('FOGOCRUZADO_EMAIL');
  const senha = Deno.env.get('FOGOCRUZADO_PASSWORD');
  if (!email || !senha) throw new Error('FOGOCRUZADO_EMAIL/FOGOCRUZADO_PASSWORD não configurados');

  const respostaLogin = await fetch('https://api-service.fogocruzado.org.br/api/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha })
  });
  if (!respostaLogin.ok) throw new Error(`Fogo Cruzado (login) respondeu ${respostaLogin.status}`);
  const token = (await respostaLogin.json())?.data?.accessToken;
  if (!token) throw new Error('Fogo Cruzado não devolveu accessToken no login');

  // O id do estado "Rio de Janeiro" é buscado dinamicamente por NOME, nunca
  // fixado no código — o UUID exato depende da base deles, e fixar um valor
  // chutado seria exatamente o tipo de invenção que este projeto proíbe.
  const respostaEstados = await fetch('https://api-service.fogocruzado.org.br/api/v2/states', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!respostaEstados.ok) throw new Error(`Fogo Cruzado (states) respondeu ${respostaEstados.status}`);
  const estados = (await respostaEstados.json())?.data || [];
  const rj = estados.find((e) => semAcento(e.name || '').toLowerCase() === 'rio de janeiro');
  if (!rj?.id) throw new Error('Fogo Cruzado não retornou o estado "Rio de Janeiro" na lista de states');

  const hoje = new Date();
  const doisDiasAtras = new Date(hoje.getTime() - 2 * 24 * 3600 * 1000);
  const paraData = (d) => d.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    idState: rj.id,
    initialdate: paraData(doisDiasAtras),
    finaldate: paraData(hoje),
    take: String(MAX_ITENS_POR_EXECUCAO),
    order: 'DESC'
  });

  const respostaOcorrencias = await fetch(
    `https://api-service.fogocruzado.org.br/api/v2/occurrences?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!respostaOcorrencias.ok) throw new Error(`Fogo Cruzado (occurrences) respondeu ${respostaOcorrencias.status}`);
  const ocorrencias = (await respostaOcorrencias.json())?.data || [];

  return ocorrencias.map((ocorrencia) => {
    const cidade = ocorrencia.city?.name || 'Rio de Janeiro';
    const bairro = ocorrencia.neighborhood?.name || null;
    const motivo = ocorrencia.contextInfo?.mainReason?.name || 'não especificado';
    const teveVitima = Array.isArray(ocorrencia.victims) && ocorrencia.victims.length > 0;
    const lat = Number(ocorrencia.latitude);
    const lng = Number(ocorrencia.longitude);

    return {
      tituloBruto: `Disparo de arma de fogo registrado em ${bairro || cidade}, ${cidade} (RJ)`,
      resumoBruto: `Ocorrência de tiroteio/disparo de arma de fogo no Rio de Janeiro (RJ), `
        + `classificada pelo Instituto Fogo Cruzado como "${motivo}". Endereço: `
        + `${ocorrencia.address || `${bairro || ''}, ${cidade}, RJ`}.`
        + (teveVitima ? ' Houve registro de vítima(s) no local.' : ''),
      url: null,
      idFonte: ocorrencia.id,
      publicadoEm: ocorrencia.date || null,
      coordenadaConhecida: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
      ocorridoEmConhecido: ocorrencia.date || null
    };
  });
}

const FONTES = [
  { nome: 'g1_rio_rss', tipo: 'public_source', coletar: coletarG1Rio },
  { nome: 'g1_rio_transito_rss', tipo: 'public_source', coletar: coletarG1RioTransito },
  { nome: 'fogo_cruzado', tipo: 'public_source', coletar: coletarFogoCruzado }
];

/* ============================================================================
   5. GEOCODIFICAÇÃO (item 17 do pedido) — Photon/OSM, mesmo serviço gratuito
      já usado no resto do site (js/geocoding.js), sem chave. Só geocodifica
      o BAIRRO que a IA extraiu (localização aproximada, mas honesta — nunca
      inventa endereço exato que a notícia não deu). Se não achar nada
      dentro do RJ, devolve null — o item fica salvo sem pino no mapa,
      marcado pra revisão, em vez de mostrar um marcador em lugar errado.
   ============================================================================ */
async function geocodificarBairro(bairro, cidade) {
  if (!bairro) return null;
  const consulta = encodeURIComponent(`${bairro}, ${cidade || 'Rio de Janeiro'}, RJ, Brasil`);
  try {
    const resposta = await fetch(`https://photon.komoot.io/api?q=${consulta}&limit=1&lat=-22.9068&lon=-43.1729&zoom=10`);
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    const coords = dados?.features?.[0]?.geometry?.coordinates; // [lon, lat]
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lat = coords[1];
    const lng = coords[0];
    if (!coordenadaEstaNoRJ(lat, lng)) return null; // fora do RJ -> rejeita (item 17)
    return { lat, lng };
  } catch {
    return null;
  }
}

/* ============================================================================
   6. IA (AIProvider) — Google Gemini
      Toda a integração com o provedor de IA fica isolada aqui dentro — pra
      trocar de provedor no futuro, troca só esta função (mesma assinatura:
      recebe texto, devolve o objeto classificado ou null).
   ============================================================================ */

const ESQUEMA_CLASSIFICACAO = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    state: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    neighborhood: { type: 'string', nullable: true },
    eventType: { type: 'string', enum: ['event', 'statistic'] },
    category: {
      type: 'string',
      enum: [
        'assedio_verbal', 'assedio_fisico', 'assalto', 'perseguicao',
        'rua_pouco_iluminada', 'local_isolado', 'acidente', 'bloqueio',
        'obra', 'tiroteio', 'geral', 'outro'
      ]
    },
    title: { type: 'string' },
    summary: { type: 'string' },
    occurredAt: { type: 'string', nullable: true },
    needsReview: { type: 'boolean' }
  },
  required: ['relevant', 'eventType', 'category', 'title', 'summary', 'needsReview']
};

const PROMPT_SISTEMA = `Você é um classificador de notícias para o Rota Segura, um app de
segurança urbana do Rio de Janeiro. Sua ÚNICA fonte de informação é o texto fornecido — nunca
invente nada que não esteja escrito nele.

IMPORTANTE SOBRE "relevant": este app usa notícia de duas formas — ocorrência de segurança
(vira pino no mapa) E notícia geral do RJ (vira só um card na aba "Notícias externas" da
Comunidade, nunca aparece no mapa). "relevant" cobre AS DUAS — não é só sobre segurança.

REGRAS OBRIGATÓRIAS:
- Se a notícia não for sobre a cidade do Rio de Janeiro ou qualquer outro município do estado
  do RJ, responda relevant=false.
- Esporte (jogo, resultado, time), política nacional sem nenhum efeito local direto, e
  entretenimento/celebridade: responda relevant=false mesmo que mencionem o Rio de Janeiro de
  passagem (ex.: "Flamengo perde jogo no Maracanã" não é relevante; um bloqueio de trânsito
  causado pelo mesmo jogo, sim).
- Qualquer outra notícia real sobre a vida na cidade (serviço público, obra, clima, trânsito,
  administração municipal/estadual com efeito local) é relevant=true, mesmo sem ligação com
  segurança — use category="geral" pra essas.
- Se um campo não estiver escrito no texto, ele é null — nunca adivinhe endereço, bairro, data
  ou hora que não estejam explícitos no texto.
- eventType="statistic" quando o texto fala de números agregados ou período (ex.: "50
  ocorrências no mês", "aumento de 10% no ano") — NUNCA crie um evento individual pra isso.
  eventType="event" só quando o texto descreve um acontecimento específico.
- Se tiver qualquer dúvida sobre a localização, a categoria ou a relevância, needsReview=true.
- Tiroteio, disparo de arma de fogo, confronto ou operação policial com troca de tiros: use
  category="tiroteio". Só use category="assalto" quando o texto descrever roubo/furto mediante
  ameaça ou violência (sem menção a tiro/disparo/arma de fogo) — nunca misture os dois.
- category="outro" é só pra ocorrência de segurança que não se encaixa nas outras categorias
  específicas. category="geral" é pra notícia local que NÃO é sobre segurança/mobilidade —
  nunca confunda as duas.
- NUNCA inclua nome completo, CPF, telefone, endereço residencial ou qualquer dado pessoal de
  vítima ou de terceiros em title/summary — descreva só o acontecimento em si.
- summary deve ser baseado exclusivamente no texto fornecido, nunca em conhecimento externo.`;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classificarComIA(texto, apiKey) {
  const modelo = 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  const corpo = {
    systemInstruction: { parts: [{ text: PROMPT_SISTEMA }] },
    contents: [{ parts: [{ text: texto }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA_CLASSIFICACAO,
      temperature: 0
    }
  };

  for (let tentativa = 1; tentativa <= TENTATIVAS_IA; tentativa++) {
    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      });
      if (resposta.status === 429 || resposta.status >= 500) {
        if (tentativa === TENTATIVAS_IA) {
          throw new Error(`Gemini respondeu ${resposta.status} após ${TENTATIVAS_IA} tentativas`);
        }
        await esperar(500 * 2 ** tentativa);
        continue;
      }
      if (!resposta.ok) {
        throw new Error(`Gemini respondeu ${resposta.status}: ${await resposta.text()}`);
      }
      const dados = await resposta.json();
      const textoResposta = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textoResposta) return null;
      return JSON.parse(textoResposta);
    } catch (erro) {
      if (tentativa >= TENTATIVAS_IA) {
        console.error('Falha ao classificar com IA:', erro);
        return null;
      }
      await esperar(500 * 2 ** tentativa);
    }
  }
  return null;
}

/* ============================================================================
   7. FLUXO PRINCIPAL — uma execução completa de coleta
   ============================================================================ */

async function expirarAntigos(supabase) {
  const { error } = await supabase
    .from('external_incidents')
    .update({ status: 'expired' })
    .in('status', ['active', 'confirmed'])
    .lt('expires_at', new Date().toISOString());
  if (error) console.error('Falha ao expirar itens antigos:', error);
}

async function jaProcessado(supabase, source, idFonte) {
  const { data } = await supabase
    .from('external_incidents')
    .select('id')
    .eq('source', source)
    .eq('source_id', idFonte)
    .maybeSingle();
  return !!data;
}

async function buscarEvidenciasProximas(supabase, item) {
  if (typeof item.lat !== 'number' && !item.neighborhood) return { reports: [], externos: [] };

  let queryReports = supabase
    .from('reports')
    .select('id,type,lat,lng,occurred_at,address')
    .eq('status', 'approved');
  let queryExternos = supabase
    .from('external_incidents')
    .select('id,category,lat,lng,occurred_at,published_at,neighborhood')
    .in('status', ['pending', 'active', 'confirmed']);

  if (typeof item.lat === 'number' && typeof item.lng === 'number') {
    const margem = 0.02; // ~2 km de folga pra filtrar candidatos antes da comparação fina
    queryReports = queryReports
      .gte('lat', item.lat - margem).lte('lat', item.lat + margem)
      .gte('lng', item.lng - margem).lte('lng', item.lng + margem);
    queryExternos = queryExternos
      .gte('lat', item.lat - margem).lte('lat', item.lat + margem)
      .gte('lng', item.lng - margem).lte('lng', item.lng + margem);
  }

  const [{ data: reports }, { data: externos }] = await Promise.all([
    queryReports.limit(50),
    queryExternos.limit(50)
  ]);
  return { reports: reports || [], externos: externos || [] };
}

async function processarItem(supabase, fonte, itemBruto, apiKey) {
  if (await jaProcessado(supabase, fonte.nome, itemBruto.idFonte)) return null; // economia de IA (item 35)

  const textoCompleto = `${itemBruto.tituloBruto}\n\n${itemBruto.resumoBruto}`;
  if (!textoMencionaMunicipioRJ(textoCompleto)) return null; // filtro geográfico ANTES da IA (item 16)

  const classificacao = await classificarComIA(textoCompleto, apiKey);
  if (!classificacao || !classificacao.relevant) return null;

  // Validação no BACKEND, nunca só na palavra da IA (item 1 do pedido).
  if (classificacao.state !== 'RJ' || !cidadeEhDoRJ(classificacao.city)) return null;

  const eventType = pareceEstatistica(textoCompleto) ? 'statistic' : classificacao.eventType;

  const registroBase = {
    source_type: fonte.tipo,
    source: fonte.nome,
    source_url: itemBruto.url || null,
    source_id: itemBruto.idFonte,
    event_type: eventType,
    category: classificacao.category,
    title: classificacao.title,
    description: classificacao.summary,
    state: 'RJ',
    city: classificacao.city,
    neighborhood: classificacao.neighborhood || null,
    // Fonte pode já trazer data exata confirmada (ex.: Fogo Cruzado) — nesse
    // caso é mais confiável que a IA tentar extrair do texto que nós mesmos
    // geramos a partir dela.
    occurred_at: itemBruto.ocorridoEmConhecido || classificacao.occurredAt || null,
    published_at: itemBruto.publicadoEm,
    ai_processed: true,
    raw_data: { itemBruto, classificacao }
  };

  // STATISTIC nunca vira alerta individual no mapa (itens 7/8 do pedido) —
  // fica salva (rastreável, nada se perde), mas com status que o app nunca
  // mostra como ocorrência ativa.
  if (eventType === 'statistic') {
    const { error } = await supabase.from('external_incidents').insert({
      ...registroBase,
      address: null, lat: null, lng: null,
      needs_review: false, status: 'rejected', confidence: 0
    });
    // Erro de insert não pode virar "sucesso silencioso" — antes só ia pro
    // log do servidor e o item ainda contava como processado no resumo,
    // escondendo falha de gravação (ex.: violação de constraint) atrás de
    // um resumo que parecia bem-sucedido.
    if (error) throw new Error(`Falha ao gravar estatística (${itemBruto.idFonte}): ${error.message}`);
    return registroBase;
  }

  // Fonte pode já trazer coordenada exata e verificada (ex.: Fogo Cruzado) —
  // aí nem tenta geocodificar por bairro, que é sempre menos preciso.
  const coordenada = itemBruto.coordenadaConhecida
    || await geocodificarBairro(classificacao.neighborhood, classificacao.city);
  // Sem localização confiável: nunca inventa pino (item 16 do pedido) — fica
  // marcado pra revisão, não aparece sozinho no mapa.
  const precisaLocalizacaoConfiavel = !coordenada;

  const registro = {
    ...registroBase,
    address: classificacao.neighborhood ? `${classificacao.neighborhood}, ${classificacao.city}` : null,
    lat: coordenada?.lat ?? null,
    lng: coordenada?.lng ?? null,
    needs_review: !!classificacao.needsReview || precisaLocalizacaoConfiavel
  };

  const { reports, externos } = await buscarEvidenciasProximas(supabase, registro);

  let matchedReportId = null;
  let evidenciasUnicas = 1;
  for (const r of reports) {
    if (pareceMesmoAcontecimento(registro, { category: r.type, lat: r.lat, lng: r.lng, occurred_at: r.occurred_at })) {
      matchedReportId = r.id;
      evidenciasUnicas += 1;
      break;
    }
  }

  let duplicateOf = null;
  for (const e of externos) {
    if (pareceMesmoAcontecimento(registro, e)) {
      duplicateOf = e.id;
      evidenciasUnicas += 1;
      break;
    }
  }

  let temContradicao = false;
  for (const e of externos) {
    if (saoContraditorios(registro, e)) { temContradicao = true; break; }
  }

  const idadeDias = registro.published_at
    ? (Date.now() - new Date(registro.published_at).getTime()) / 86400000
    : 0;

  registro.confidence = calcularConfianca({
    sourceType: registro.source_type,
    lat: registro.lat, lng: registro.lng, address: registro.address, neighborhood: registro.neighborhood,
    occurred_at: registro.occurred_at, published_at: registro.published_at,
    evidenciasUnicas, temContradicao, idadeDias
  });
  registro.matched_report_id = matchedReportId;
  registro.duplicate_of = duplicateOf;
  registro.status = temContradicao
    ? 'disputed'
    : registro.needs_review
      ? 'pending'
      : (matchedReportId ? 'confirmed' : 'active');
  registro.expires_at = expiraEm(registro.category, registro.published_at ? new Date(registro.published_at) : new Date());

  const { error } = await supabase.from('external_incidents').insert(registro);
  // Mesmo motivo do bloco "statistic" acima: erro de insert precisa
  // interromper o item (e aparecer em resumo.erros), nunca só logar e seguir
  // como se tivesse gravado.
  if (error) throw new Error(`Falha ao gravar incidente (${itemBruto.idFonte}): ${error.message}`);
  return registro;
}

async function coletarTudo(supabase, apiKey) {
  await expirarAntigos(supabase);
  const resumo = { fontes: {}, erros: [] };

  for (const fonte of FONTES) {
    try {
      const itens = await fonte.coletar();
      let processados = 0;
      for (const item of itens.slice(0, MAX_ITENS_POR_EXECUCAO)) {
        try {
          const resultado = await processarItem(supabase, fonte, item, apiKey);
          if (resultado) processados++;
        } catch (erroItem) {
          resumo.erros.push(`${fonte.nome}/${item.idFonte}: ${erroItem.message}`);
        }
      }
      resumo.fontes[fonte.nome] = { encontrados: itens.length, processados };
    } catch (erroFonte) {
      // Uma fonte fora do ar não derruba as outras (item 37 do pedido).
      resumo.erros.push(`${fonte.nome} indisponível: ${erroFonte.message}`);
      resumo.fontes[fonte.nome] = { erro: erroFonte.message };
    }
  }
  return resumo;
}

/* ============================================================================
   8. SERVIDOR — só roda quando o arquivo é EXECUTADO de verdade, nunca
      quando é só importado (é isso que permite testar as funções puras
      acima com dado simulado, sem precisar de Deno nem de chamar a IA de
      verdade — ver COMO_CONFIGURAR_COLETA_RJ.md, seção de testes).
   ============================================================================ */
if (import.meta.main) {
  Deno.serve(async (req) => {
    // Cabeçalho PRÓPRIO (não "authorization") de propósito: o "authorization"
    // já é usado pelo gateway do Supabase pra checar a credencial dele mesmo
    // (a chave secreta do projeto) — usar o mesmo cabeçalho pra duas coisas
    // ao mesmo tempo (a credencial do Supabase E a nossa senha própria)
    // colidia, e o gateway barrava a chamada antes de chegar aqui.
    const segredoEsperado = Deno.env.get('COLETA_SECRET');
    const segredoRecebido = req.headers.get('x-coleta-secret') || '';
    if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
      return new Response(JSON.stringify({ erro: 'Não autorizado.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ erro: 'GEMINI_API_KEY não configurada nos secrets da função.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ erro: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não disponíveis pra esta função.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    try {
      const resumo = await coletarTudo(supabase, apiKey);
      return new Response(JSON.stringify(resumo), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (erro) {
      console.error('Falha geral na coleta:', erro);
      return new Response(JSON.stringify({ erro: 'Falha ao coletar. Veja os logs da função.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
}
