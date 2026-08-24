// ============================================================================
// ROTA SEGURA — Edge Function: calcular-rota
// ----------------------------------------------------------------------------
// Fica entre o site (estático, sem servidor) e o OpenRouteService. A chave do
// OpenRouteService mora só aqui, como "secret" do Supabase — nunca no código
// que vai para o navegador.
//
// COMO PUBLICAR: copie e cole este arquivo inteiro no editor do Dashboard do
// Supabase (Edge Functions -> Deploy a new function -> Via Editor). Passo a
// passo completo na Etapa 12 do GUIA_PASSO_A_PASSO.md.
//
// Recebe:  { origem: {lat, lng}, destino: {lat, lng}, perfil?: "foot-walking" | "driving-car" }
// Devolve: { rotas: [{ distanciaM, duracaoS, geometria: [[lat,lng], ...], passos: [...] }, ...] }
//
// `passos` vem do OpenRouteService (instructions em português) — usado pela
// navegação por voz (js/navigation.js): cada passo tem o texto da instrução
// e o ÍNDICE, dentro de `geometria`, de onde a manobra acontece
// (indiceInicio/indiceFim), pra saber quando anunciar cada um conforme a
// posição da pessoa avança pela rota.
//
// Pede ao OpenRouteService até 3 caminhos alternativos (o máximo que ele
// aceita) entre a mesma origem e destino, em vez de só o primeiro que ele
// devolver. Quem decide qual dos 3 usar é o app (routes.js): pontua cada
// alternativa pela proximidade de relatos de segurança e de pontos de apoio/
// delegacias, e escolhe a de menor risco — não necessariamente a mais curta.
// Essa é a mudança que faz o "Rota segura" do card ser uma escolha de
// verdade, e não só um nome pra rota única de sempre.
// ============================================================================

const CABECALHOS_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Só estes dois perfis do OpenRouteService são aceitos — nunca repassamos o
// valor que chegou do navegador direto para a URL sem checar contra esta lista.
const PERFIS_VALIDOS = new Set(["foot-walking", "driving-car"]);

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" }
  });
}

function coordenadaValida(ponto: unknown): ponto is { lat: number; lng: number } {
  if (!ponto || typeof ponto !== "object") return false;
  const p = ponto as Record<string, unknown>;
  return (
    typeof p.lat === "number" && Number.isFinite(p.lat) &&
    typeof p.lng === "number" && Number.isFinite(p.lng)
  );
}

Deno.serve(async (req: Request) => {
  // Preflight do CORS: o navegador manda isso antes do POST de verdade.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CABECALHOS_CORS });
  }

  if (req.method !== "POST") {
    return respostaJson({ erro: "Método não permitido." }, 405);
  }

  const chaveOrs = Deno.env.get("ORS_API_KEY");
  if (!chaveOrs) {
    console.error("ORS_API_KEY não configurada nos secrets da função.");
    return respostaJson(
      { erro: "O serviço de rotas não está configurado. Avise quem administra o site." },
      500
    );
  }

  let corpo: { origem?: unknown; destino?: unknown; perfil?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return respostaJson({ erro: "Requisição inválida." }, 400);
  }

  const { origem, destino } = corpo;
  if (!coordenadaValida(origem) || !coordenadaValida(destino)) {
    return respostaJson({ erro: "Origem e destino precisam ter lat e lng válidos." }, 400);
  }
  const perfil = typeof corpo.perfil === "string" && PERFIS_VALIDOS.has(corpo.perfil)
    ? corpo.perfil
    : "foot-walking";

  try {
    const respostaOrs = await fetch(
      `https://api.openrouteservice.org/v2/directions/${perfil}/geojson`,
      {
        method: "POST",
        headers: {
          Authorization: chaveOrs,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          // O OpenRouteService usa [longitude, latitude], ao contrário do Leaflet.
          coordinates: [
            [origem.lng, origem.lat],
            [destino.lng, destino.lat]
          ],
          // target_count 3 é o máximo aceito pela API; weight_factor/
          // share_factor são os valores recomendados na documentação do
          // OpenRouteService pra gerar alternativas realmente diferentes
          // entre si (não 3 variações quase idênticas da mesma rua).
          alternative_routes: { target_count: 3, weight_factor: 1.4, share_factor: 0.6 },
          // Instruções de navegação já em português, direto do ORS — não
          // inventamos texto de manobra por conta própria (regra geral do
          // projeto: nunca fabricar informação que dá pra pedir de verdade).
          instructions: true,
          language: "pt"
        })
      }
    );

    if (respostaOrs.status === 429) {
      return respostaJson(
        { erro: "Muitas rotas calculadas em pouco tempo. Espere um instante e tente de novo." },
        429
      );
    }
    if (respostaOrs.status === 401 || respostaOrs.status === 403) {
      console.error("OpenRouteService recusou a chave:", respostaOrs.status);
      return respostaJson(
        { erro: "A chave do serviço de rotas não foi aceita. Confira o secret ORS_API_KEY." },
        502
      );
    }
    if (!respostaOrs.ok) {
      console.error("OpenRouteService respondeu com erro:", respostaOrs.status, await respostaOrs.text());
      return respostaJson(
        { erro: "Não foi possível calcular a rota agora. Tente novamente." },
        502
      );
    }

    const dados = await respostaOrs.json();
    const features = Array.isArray(dados?.features) ? dados.features : [];

    // Cada feature é uma alternativa de caminho completa (própria distância,
    // duração e geometria) — o ORS não garante sempre devolver 3; às vezes
    // só existe 1 caminho razoável entre os pontos, e a lista vem com 1 só.
    const rotas = features
      .map((feature: any) => {
        const resumo = feature?.properties?.summary;
        const coordenadas = feature?.geometry?.coordinates;
        if (!resumo || !Array.isArray(coordenadas) || coordenadas.length < 2) return null;

        // Um segmento por trecho entre pontos consecutivos da rota — como só
        // pedimos origem+destino (2 coordenadas), o ORS sempre devolve 1
        // segmento só, mas soma todos por segurança se isso mudar um dia.
        const segmentos = Array.isArray(feature?.properties?.segments) ? feature.properties.segments : [];
        const passos = segmentos
          .flatMap((seg: any) => (Array.isArray(seg?.steps) ? seg.steps : []))
          .map((passo: any) => {
            const wp = Array.isArray(passo?.way_points) ? passo.way_points : null;
            if (!passo?.instruction || !wp || wp.length < 2) return null;
            return {
              instrucao: String(passo.instruction),
              distanciaM: Math.round(passo.distance || 0),
              indiceInicio: wp[0],
              indiceFim: wp[1]
            };
          })
          .filter((p: unknown) => p !== null);

        return {
          distanciaM: Math.round(resumo.distance),
          duracaoS: Math.round(resumo.duration),
          // Devolve já no formato [lat, lng] que o Leaflet espera.
          geometria: coordenadas.map(([lon, lat]: [number, number]) => [lat, lon]),
          passos
        };
      })
      .filter((r: unknown): r is { distanciaM: number; duracaoS: number; geometria: number[][]; passos: unknown[] } => r !== null);

    if (!rotas.length) {
      const meioDeTransporte = perfil === "driving-car" ? "de carro" : "a pé";
      return respostaJson(
        { erro: `Não encontramos um caminho ${meioDeTransporte} entre esses dois pontos.` },
        404
      );
    }

    return respostaJson({ rotas });
  } catch (erro) {
    console.error("Falha ao chamar o OpenRouteService:", erro);
    return respostaJson(
      { erro: "Não foi possível falar com o serviço de rotas agora. Tente novamente." },
      502
    );
  }
});
