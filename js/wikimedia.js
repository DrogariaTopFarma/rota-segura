/* ============================================================================
   ROTA SEGURA — Fotos reais do Wikimedia Commons, por proximidade
   Usado nos popups de ponto de ônibus (js/map.js): mostra foto(s) de
   verdade tiradas perto do local, nunca uma imagem genérica/inventada.

   IMPORTANTE sobre o que isto DEVOLVE: a API de geosearch do Commons acha
   QUALQUER arquivo com coordenada perto do ponto — não necessariamente uma
   foto do ponto de ônibus em si (pode ser um prédio, uma praça, uma planta
   fotografada ali perto). Por isso a tela nunca afirma "foto deste ponto de
   ônibus", só "foto real tirada perto daqui" — rótulo honesto pro que a API
   realmente garante.

   Sem chave, sem cadastro, CORS liberado (origin=*) — confirmado ao vivo
   nesta sessão. Licença varia por arquivo (ver extmetadata.LicenseShortName),
   por isso SEMPRE exibimos autor + licença junto da foto.
   ============================================================================ */

const BASE = 'https://commons.wikimedia.org/w/api.php';
const RAIO_BUSCA_M = 200;
const cache = new Map();

/** Busca até `limite` fotos reais do Wikimedia Commons perto de (lat, lng).
    Devolve [] se não achar nada ou se a API falhar — nunca lança erro (é uma
    camada de enriquecimento visual, não pode travar o popup do mapa). */
export async function buscarFotosProximas(lat, lng, { limite = 2 } = {}) {
  const chave = `${lat.toFixed(5)},${lng.toFixed(5)},${limite}`;
  if (cache.has(chave)) return cache.get(chave);

  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(RAIO_BUSCA_M),
    ggsnamespace: '6', // namespace de arquivos (File:)
    ggslimit: String(limite),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '480',
    format: 'json',
    origin: '*'
  });

  let fotos = [];
  try {
    const resposta = await fetch(`${BASE}?${params}`);
    if (resposta.ok) {
      const dados = await resposta.json();
      const paginas = Object.values(dados?.query?.pages || {});
      fotos = paginas
        .map((pagina) => {
          const info = pagina?.imageinfo?.[0];
          if (!info) return null;
          const meta = info.extmetadata || {};
          return {
            url: info.thumburl || info.url,
            urlOriginal: info.url,
            paginaUrl: info.descriptionurl,
            autor: despirHtml(meta.Artist?.value) || 'Autor não identificado',
            licenca: meta.LicenseShortName?.value || 'Licença não informada'
          };
        })
        .filter(Boolean);
    }
  } catch {
    fotos = []; // sem internet/instabilidade na API — o popup só mostra "sem foto"
  }

  cache.set(chave, fotos);
  return fotos;
}

/** O campo "Artist" do Commons costuma vir como HTML (ex.: um link <a>) —
    tira as tags pra mostrar só o texto no popup, sem arriscar HTML estranho
    dentro do mapa. */
function despirHtml(textoComHtml) {
  if (!textoComHtml) return '';
  const div = document.createElement('div');
  div.innerHTML = textoComHtml;
  return (div.textContent || '').trim();
}
