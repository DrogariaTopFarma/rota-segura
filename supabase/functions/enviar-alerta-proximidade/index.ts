// ============================================================================
// ROTA SEGURA — Edge Function: enviar-alerta-proximidade
// ----------------------------------------------------------------------------
// Diferente de calcular-rota e coletar-fontes, esta função NUNCA é chamada
// pelo site — é chamada pelo próprio SUPABASE, sozinho, via "Database
// Webhook" (configuração de painel, não dá pra fazer só com SQL): toda vez
// que um relato novo vira `approved` em `reports`, ou uma notícia pública
// nasce já `active`/`confirmed` em `external_incidents`, o Supabase manda um
// POST pra cá com a linha inteira — e esta função avisa, por notificação
// push, quem estiver com o alerta ligado perto daquele ponto (mesmo com o
// site fechado no aparelho da pessoa).
//
// COMO PUBLICAR: mesmo processo das outras — copie e cole este arquivo
// inteiro no editor do Dashboard do Supabase (Edge Functions -> Deploy a
// new function -> Via Editor, nome da função: "enviar-alerta-proximidade").
//
// COMO CONFIGURAR O DATABASE WEBHOOK (passo que só dá pra fazer no painel,
// não neste código — passo a passo completo em COMO_CONFIGURAR_ALERTAS.md):
//   Database -> Webhooks -> Create a new hook, duas vezes (uma por tabela):
//     1. Tabela `reports`, evento INSERT, URL desta função, header
//        `x-alerta-secret: <ALERTA_SECRET>` (mesma senha do secret abaixo).
//     2. Tabela `external_incidents`, evento INSERT, mesma URL, mesmo header.
//
// SECRETS NECESSÁRIOS (Dashboard -> Edge Functions -> enviar-alerta-
// proximidade -> Secrets):
//   ALERTA_SECRET      — senha inventada por você, só pra esta função aceitar
//                        só chamadas do próprio Database Webhook (mesmo
//                        princípio do COLETA_SECRET de coletar-fontes: vai
//                        num cabeçalho PRÓPRIO, não em "authorization",
//                        porque esse já é usado pelo gateway do Supabase pra
//                        conferir a credencial dele mesmo).
//   VAPID_PUBLIC_KEY   — mesma chave pública que está em js/config.js
//                        (VAPID_PUBLIC_KEY) — não é segredo, mas precisa
//                        estar nos dois lugares.
//   VAPID_PRIVATE_KEY  — a chave PRIVADA do par VAPID. Sensível de verdade
//                        (é o que prova pro navegador que a notificação vem
//                        de quem tem autorização pra mandar) — nunca no
//                        código, só aqui.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos automaticamente
// (mesmo princípio das outras funções deste projeto).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const RAIO_MAXIMO_BUSCA_M = 5000; // maior raio_m que uma assinatura pode ter, pra montar o filtro grosso

const ROTULOS_RELATO: Record<string, string> = {
  assedio_verbal: 'assédio verbal',
  assedio_fisico: 'assédio físico',
  assalto: 'assalto',
  perseguicao: 'perseguição',
  rua_pouco_iluminada: 'rua pouco iluminada',
  local_isolado: 'local isolado',
  outro: 'ocorrência'
};

const ROTULOS_INCIDENTE_EXTERNO: Record<string, string> = {
  assedio_verbal: 'assédio verbal',
  assedio_fisico: 'assédio físico',
  assalto: 'assalto/violência armada',
  perseguicao: 'perseguição',
  rua_pouco_iluminada: 'rua pouco iluminada',
  local_isolado: 'local isolado',
  acidente: 'acidente de trânsito',
  bloqueio: 'bloqueio de via',
  obra: 'obra',
  outro: 'ocorrência'
};

/** Mesma fórmula (haversine) usada em todo o resto do projeto (js/ui.js,
    coletar-fontes) — repetida aqui porque a função roda isolada em Deno. */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function montarNotificacao(tabela: string, registro: Record<string, unknown>) {
  if (tabela === 'reports') {
    const tipo = ROTULOS_RELATO[registro.type as string] || 'ocorrência';
    return {
      title: 'Relato de segurança perto de você',
      body: `Um relato de ${tipo} foi registrado perto de onde você está.`,
      tag: 'rota-segura-relato'
    };
  }
  const categoria = ROTULOS_INCIDENTE_EXTERNO[registro.category as string] || 'ocorrência';
  return {
    title: 'Notícia pública perto de você',
    body: `Uma notícia de ${categoria} foi registrada perto de onde você está.`,
    tag: 'rota-segura-noticia'
  };
}

// Só roda o servidor quando o arquivo é EXECUTADO de verdade, nunca quando é
// só importado — mesmo padrão de coletar-fontes/index.ts: permite testar
// montarNotificacao/distanciaMetros isoladas, com dado simulado, sem
// precisar de Deno nem chamar o Supabase/Web Push de verdade.
if (import.meta.main) {
Deno.serve(async (req: Request) => {
  const segredoEsperado = Deno.env.get('ALERTA_SECRET');
  const segredoRecebido = req.headers.get('x-alerta-secret') || '';
  if (!segredoEsperado || segredoRecebido !== segredoEsperado) {
    return new Response(JSON.stringify({ erro: 'Não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const vapidPublica = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivada = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublica || !vapidPrivada) {
    return new Response(JSON.stringify({ erro: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ erro: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não disponíveis.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let corpo: { type?: string; table?: string; record?: Record<string, unknown> };
  try {
    corpo = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: 'Corpo inválido.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { table, record } = corpo;
  if (!record || (table !== 'reports' && table !== 'external_incidents')) {
    return new Response(JSON.stringify({ ignorado: true, motivo: 'tabela não relevante' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Só alerta sobre o que realmente aparece pra alguém no app — nunca um
  // relato ainda `pending` nem uma notícia `disputed`/`rejected`/`expired`.
  const statusRelevante = table === 'reports'
    ? record.status === 'approved'
    : record.status === 'active' || record.status === 'confirmed';
  if (!statusRelevante) {
    return new Response(JSON.stringify({ ignorado: true, motivo: 'status não é público' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const lat = record.lat as number | null;
  const lng = record.lng as number | null;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return new Response(JSON.stringify({ ignorado: true, motivo: 'sem coordenada' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  webpush.setVapidDetails('mailto:contato@rotasegura.app', vapidPublica, vapidPrivada);

  // Filtro grosso por caixa (barato) — a distância de verdade, contra o
  // raio_m PRÓPRIO de cada assinatura, é conferida linha a linha depois.
  const margemGraus = RAIO_MAXIMO_BUSCA_M / 111000;
  const { data: assinaturas, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, lat, lng, raio_m')
    .gte('lat', lat - margemGraus).lte('lat', lat + margemGraus)
    .gte('lng', lng - margemGraus).lte('lng', lng + margemGraus);

  if (error) {
    console.error('Falha ao buscar assinaturas:', error);
    return new Response(JSON.stringify({ erro: 'Falha ao buscar assinaturas.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const notificacao = montarNotificacao(table, record);
  const payload = JSON.stringify({ ...notificacao, url: 'pages/mapa.html' });

  let enviados = 0;
  let expirados = 0;
  const erros: string[] = [];

  for (const assinatura of assinaturas || []) {
    if (typeof assinatura.lat !== 'number' || typeof assinatura.lng !== 'number') continue;
    const dist = distanciaMetros(lat, lng, assinatura.lat, assinatura.lng);
    if (dist > (assinatura.raio_m || 1500)) continue;

    try {
      await webpush.sendNotification(
        {
          endpoint: assinatura.endpoint,
          keys: { p256dh: assinatura.p256dh, auth: assinatura.auth }
        },
        payload
      );
      enviados++;
    } catch (erroEnvio: any) {
      // 404/410: o navegador cancelou essa assinatura por conta própria
      // (desinstalou o app, limpou dados etc.) — apaga daqui também, senão
      // ela fica pra sempre tentando (e falhando) a cada alerta novo.
      if (erroEnvio?.statusCode === 404 || erroEnvio?.statusCode === 410) {
        expirados++;
        await supabase.from('push_subscriptions').delete().eq('id', assinatura.id);
      } else {
        erros.push(`${assinatura.id}: ${erroEnvio?.message || erroEnvio}`);
      }
    }
  }

  return new Response(JSON.stringify({ enviados, expirados, candidatos: (assinaturas || []).length, erros }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});
}
