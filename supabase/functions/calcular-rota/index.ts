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
// Devolve: { distanciaM, duracaoS, geometria: [[lat,lng], ...] }
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
          ]
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
    const feature = dados?.features?.[0];
    const resumo = feature?.properties?.summary;
    const coordenadas = feature?.geometry?.coordinates;

    if (!feature || !resumo || !Array.isArray(coordenadas) || coordenadas.length < 2) {
      const meioDeTransporte = perfil === "driving-car" ? "de carro" : "a pé";
      return respostaJson(
        { erro: `Não encontramos um caminho ${meioDeTransporte} entre esses dois pontos.` },
        404
      );
    }

    return respostaJson({
      distanciaM: Math.round(resumo.distance),
      duracaoS: Math.round(resumo.duration),
      // Devolve já no formato [lat, lng] que o Leaflet espera.
      geometria: coordenadas.map(([lon, lat]: [number, number]) => [lat, lon])
    });
  } catch (erro) {
    console.error("Falha ao chamar o OpenRouteService:", erro);
    return respostaJson(
      { erro: "Não foi possível falar com o serviço de rotas agora. Tente novamente." },
      502
    );
  }
});
