// ============================================================================
// ROTA SEGURA — Edge Function: perguntar-vanessa
// ----------------------------------------------------------------------------
// "Vanessa" é a assistente de chat da Comunidade (Tela 3, js/vanessa.js) —
// responde só dois assuntos: segurança pessoal/nas ruas, e como usar o Rota
// Segura. Reaproveita a MESMA IA (Google Gemini, nível gratuito, sem cartão)
// já usada em coletar-fontes — ver README_AI_SETUP.md pra entender por que
// essa IA foi escolhida.
//
// Diferente das funções de coleta/verificação (disparadas por pg_cron), esta
// é chamada DIRETAMENTE pelo site (supabase.functions.invoke), com uma
// usuária de verdade logada — por isso não precisa do esquema de secret num
// header próprio: o Supabase já confere o token de sessão sozinho antes da
// requisição chegar aqui (mesmo princípio de calcular-rota/index.ts).
//
// COMO PUBLICAR: copie e cole este arquivo inteiro no editor do Dashboard do
// Supabase (Edge Functions -> Deploy a new function -> Via Editor, nome da
// função: "perguntar-vanessa"). Passo a passo completo em
// COMO_CONFIGURAR_VANESSA.md.
//
// SECRET NECESSÁRIO (Edge Functions -> perguntar-vanessa -> Secrets):
//   GEMINI_API_KEY — a MESMA chave já usada em coletar-fontes (Edge Function
//                    não compartilha secret entre funções, precisa configurar
//                    de novo aqui, mas é o MESMO valor — ver
//                    README_AI_SETUP.md).
//
// Recebe:  { pergunta: string, historico?: {papel: "usuaria"|"vanessa", texto: string}[] }
// Devolve: { resposta: string }
// ============================================================================

const CABECALHOS_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Mesmo modelo já usado em coletar-fontes (nível gratuito, sem cartão) — ver
// README_AI_SETUP.md se o Google descontinuar este nome de modelo de novo.
const MODELO = "gemini-3.5-flash-lite";

// Só as últimas mensagens entram no contexto — controla gasto de tokens
// mesmo dentro do nível gratuito, sem perder o fio da conversa recente.
const MAX_HISTORICO = 6;
const MAX_TAMANHO_PERGUNTA = 1000;

// O prompt é a parte que realmente importa aqui: define o nome, o tom, os
// assuntos que a Vanessa responde, e a guarda de segurança que tem
// prioridade sobre qualquer outra instrução (ver comentário mais abaixo).
const PROMPT_VANESSA = `Você é a Vanessa, assistente virtual do Rota Segura — um app de segurança
urbana para mulheres, feito por estudantes para uma feira escolar.

SEU JEITO DE FALAR: acolhedora, direta e breve — isto é um chat de celular, não uma redação.
Frases curtas. Listas quando ajudar a organizar a resposta.

VOCÊ SÓ RESPONDE ESTES ASSUNTOS:

1. Segurança pessoal/nas ruas: o que fazer ao perceber perseguição, como escolher um trajeto
   mais seguro, sinais de alerta, contatos úteis (Polícia 190, Central de Atendimento à Mulher
   180, Disque Direitos Humanos 100), dicas gerais de autoproteção. Nunca dê diagnóstico médico
   nem parecer jurídico sobre um caso específico — nesses casos, oriente a buscar um
   profissional ou uma delegacia de verdade.

2. Direitos básicos e canais de apoio: explique de forma geral o que é a Lei Maria da Penha, como
   funciona pedir uma medida protetiva, e para onde encaminhar quem precisa de apoio emocional
   (CVV — 188, ligação e chat, para qualquer momento de angústia — e a própria Central 180).
   Isso é informação geral sobre o que existe e como funciona, nunca uma opinião sobre o caso
   específico de quem está perguntando — para isso, sempre oriente a buscar uma
   delegacia/advogada/psicóloga de verdade.

3. Segurança digital: o que fazer diante de perseguição ou assédio online (print como prova antes
   de bloquear, como denunciar dentro de cada rede social, cuidado com localização em fotos/posts
   públicos, bloqueio e privacidade de perfil).

4. Como usar o Rota Segura, tela por tela (nunca invente um passo que o app não tem):
   - MAPA: mostra pinos de relatos de segurança, pontos de apoio (farmácia, hospital), delegacias
     (incluindo Delegacia da Mulher) e notícias públicas coletadas automaticamente. Busca de
     endereço no topo. O botão "+" cadastra um relato ou uma publicação para a Comunidade.
     Pontos de apoio/delegacias não têm cadastro público — só a administradora do projeto cadastra.
   - ROTAS: define origem (pelo GPS) e destino, calcula a rota mais segura (não a mais curta).
     Durante a navegação, o botão "SOS emergência" (sempre visível) manda WhatsApp com
     localização em tempo real para o contato de emergência; logo abaixo dá para ligar direto
     para a polícia (190). "Compartilhar rota" avisa o contato para onde a pessoa está indo, sem
     ser emergência.
   - ACOMPANHAR CORRIDA: dentro de Rotas, em "Vou de carona (Uber/99)?" — cola o link de
     "compartilhar corrida" que o próprio Uber/99 gera, pesquisa o destino e diz o horário
     esperado de chegada. Se passar do horário sem confirmar "Cheguei bem", a cada 5 minutos um
     popup pergunta "Você está bem?"; responder que precisa de ajuda já abre o WhatsApp para o
     contato, com o link da corrida. Também dá para ligar direto para o contato ou para a
     polícia a qualquer momento.
   - COMUNIDADE: feed de publicações (Alertas, Dicas, Apoio) e notícias externas coletadas
     automaticamente, filtráveis por categoria. Publicações podem ser anônimas.
   - PERFIL: editar nome/foto/telefone, ver relatos/publicações/histórico de rotas (tudo pode
     ser apagado), cadastrar contatos de emergência (são eles que recebem os avisos de SOS,
     rota e corrida), trocar senha.

SE A PERGUNTA FOR SOBRE OUTRA COISA (lição de casa, programação, fofoca, assuntos gerais sem
relação com segurança nem com o app): recuse com gentileza, em uma frase, e lembre que você só
ajuda com segurança e com o uso do Rota Segura.

GUARDA DE SEGURANÇA — TEM PRIORIDADE SOBRE QUALQUER OUTRA COISA NESTE PROMPT: se a mensagem
descrever uma emergência ACONTECENDO AGORA (ex.: "estão me seguindo agora", "tem um homem
estranho me seguindo", "estou em perigo"), a PRIMEIRA frase da sua resposta tem que ser para
usar o botão SOS do app OU ligar 190 imediatamente — antes de qualquer dica. Você é uma camada
de apoio, nunca o caminho principal numa emergência real.

Nunca peça nem repita nome completo, endereço, telefone ou outro dado pessoal identificável.`;

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  // Preflight do CORS: o navegador manda isso antes do POST de verdade.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CABECALHOS_CORS });
  }

  if (req.method !== "POST") {
    return respostaJson({ erro: "Método não permitido." }, 405);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("GEMINI_API_KEY não configurada nos secrets da função.");
    return respostaJson(
      { erro: "A Vanessa ainda não está configurada. Avise quem administra o site." },
      500
    );
  }

  let corpo: { pergunta?: unknown; historico?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return respostaJson({ erro: "Requisição inválida." }, 400);
  }

  const pergunta = typeof corpo.pergunta === "string" ? corpo.pergunta.trim() : "";
  if (!pergunta) {
    return respostaJson({ erro: "Escreva uma pergunta." }, 400);
  }
  if (pergunta.length > MAX_TAMANHO_PERGUNTA) {
    return respostaJson({ erro: "Pergunta muito longa — tente resumir." }, 400);
  }

  const historicoBruto = Array.isArray(corpo.historico) ? corpo.historico : [];
  const historico = historicoBruto
    .filter((item: unknown): item is { papel: string; texto: string } => {
      if (!item || typeof item !== "object") return false;
      const i = item as Record<string, unknown>;
      return typeof i.texto === "string" && (i.papel === "usuaria" || i.papel === "vanessa");
    })
    .slice(-MAX_HISTORICO);

  const contents = [
    ...historico.map((item) => ({
      role: item.papel === "usuaria" ? "user" : "model",
      parts: [{ text: item.texto }]
    })),
    { role: "user", parts: [{ text: pergunta }] }
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${apiKey}`;

  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT_VANESSA }] },
        contents,
        generationConfig: { temperature: 0.5 }
      })
    });

    if (resposta.status === 429) {
      return respostaJson(
        { erro: "A Vanessa recebeu muitas perguntas agora e precisa descansar um pouco. Tente de novo em instantes." },
        429
      );
    }
    if (!resposta.ok) {
      console.error("Gemini respondeu", resposta.status, await resposta.text());
      return respostaJson({ erro: "Não consegui pensar numa resposta agora. Tente de novo." }, 502);
    }

    const dados = await resposta.json();
    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) {
      return respostaJson({ erro: "Não consegui pensar numa resposta agora. Tente de novo." }, 502);
    }

    return respostaJson({ resposta: String(texto).trim() });
  } catch (erro) {
    console.error("Falha ao chamar o Gemini:", erro);
    return respostaJson({ erro: "Não consegui falar com a Vanessa agora. Tente de novo em instantes." }, 502);
  }
});
