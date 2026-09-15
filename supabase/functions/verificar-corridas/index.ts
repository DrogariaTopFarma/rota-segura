// ============================================================================
// ROTA SEGURA — Edge Function: verificar-corridas
// ----------------------------------------------------------------------------
// Parte de "Acompanhar corrida" (Tela 2 — Rotas): a usuária cola o link de
// "compartilhar corrida" que o próprio Uber/99 já gera (não existe API
// pública que deixe um app terceiro ler o GPS de uma corrida alheia — só o
// que o próprio app dela decide compartilhar) e define um horário esperado
// de chegada. Esta função roda periodicamente (agendada por pg_cron, mesmo
// padrão de coletar-fontes — ver COMO_CONFIGURAR_ALERTAS.md) e, 5 minutos
// depois do prazo vencer sem confirmação, manda UMA notificação perguntando
// "Está tudo bem?" — a partir daí, a decisão (confirmar ou avisar o contato)
// é sempre da própria usuária, tocando na notificação (ver js/carona.js).
//
// LIMITE HONESTO (não esconder isso na UI nem no código): isso é uma camada
// de lembrete/tranquilidade, nunca um substituto de ligar pra 190. A função
// NUNCA avisa o contato de emergência sozinha — ele não é usuária do app,
// não tem assinatura de push — só lembra A PRÓPRIA usuária de fazer isso com
// um toque (ver js/emergency.js, obterLinkDeConfirmacaoAtrasada).
//
// COMO PUBLICAR: mesmo processo das outras — copie e cole este arquivo
// inteiro no editor do Dashboard do Supabase (Edge Functions -> Deploy a
// new function -> Via Editor, nome da função: "verificar-corridas").
//
// COMO É DISPARADA: pg_cron, a cada poucos minutos (não é webhook, é baseado
// em tempo/prazo vencendo — ver COMO_CONFIGURAR_ALERTAS.md pro SQL completo
// do agendamento). Cabeçalho próprio x-verificar-secret, nunca confia só no
// gateway do Supabase.
//
// SECRETS NECESSÁRIOS (Dashboard -> Edge Functions -> verificar-corridas ->
// Secrets):
//   VERIFICAR_SECRET   — senha inventada por você, só pra esta função aceitar
//                        só chamadas do agendamento (mesmo princípio do
//                        COLETA_SECRET/ALERTA_SECRET das outras funções).
//   VAPID_PUBLIC_KEY   — mesma chave já usada em enviar-alerta-proximidade e
//                        em js/config.js — Edge Function não compartilha
//                        secret entre funções, precisa configurar de novo
//                        aqui, mas é o MESMO valor, não gere um par novo.
//   VAPID_PRIVATE_KEY  — idem, mesmo valor da outra função. Sensível de
//                        verdade, nunca no código.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos automaticamente.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

// Quanto tempo depois do horário esperado esperar antes de perguntar "está
// tudo bem?" — configurável aqui, fácil de reajustar depois de usar na
// prática. Só UMA pergunta por corrida: a partir daí, a "escalação" é 100%
// a resposta da própria usuária (toca "Não" → abre WhatsApp na hora — ver
// js/carona.js), não mais um segundo aviso automático depois de um tempo.
const MINUTOS_APOS_PRAZO_PARA_PERGUNTAR = 5;

/** Decide o que fazer com UMA corrida, dado o horário atual — função pura,
    sem Deno.*, testável com dado simulado (relógio arbitrário) sem precisar
    chamar o Supabase nem o Web Push de verdade.
    Devolve 'perguntar', ou null (nada a fazer agora). */
export function decidirAcao(corrida: {
  status: string;
  confirmed_at: string | null;
  expected_arrival_at: string;
  reminder_sent_at: string | null;
}, agoraMs: number): 'perguntar' | null {
  if (corrida.status !== 'ativa' || corrida.confirmed_at || corrida.reminder_sent_at) return null;

  const prazoMs = new Date(corrida.expected_arrival_at).getTime();
  const minutosAtrasada = (agoraMs - prazoMs) / 60000;
  if (minutosAtrasada >= MINUTOS_APOS_PRAZO_PARA_PERGUNTAR) return 'perguntar';

  return null;
}

function montarNotificacao(corridaId: string) {
  return {
    title: 'Está tudo bem?',
    body: 'Você já devia ter chegado. Toque pra confirmar que está tudo bem ou avisar seu contato de emergência.',
    tag: 'rota-segura-corrida',
    url: `pages/rotas.html?confirmarCorrida=${corridaId}`
  };
}

/** Manda push pra TODAS as assinaturas de UMA usuária (não por proximidade
    — mesmo padrão de sendNotification/limpeza 404-410 de
    enviar-alerta-proximidade, só que filtrado por user_id em vez de
    distância). */
async function enviarPushParaUsuaria(supabase, userId: string, payload: string) {
  const { data: assinaturas } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  let enviados = 0;
  for (const assinatura of assinaturas || []) {
    try {
      await webpush.sendNotification(
        { endpoint: assinatura.endpoint, keys: { p256dh: assinatura.p256dh, auth: assinatura.auth } },
        payload
      );
      enviados++;
    } catch (erroEnvio: any) {
      if (erroEnvio?.statusCode === 404 || erroEnvio?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', assinatura.id);
      }
      // outros erros de envio não abortam o lote — só essa assinatura falha
    }
  }
  return enviados;
}

async function verificarTudo(supabase) {
  const agora = new Date();
  const resumo = { verificadas: 0, perguntas: 0, erros: [] as string[] };

  const { data: corridas, error } = await supabase
    .from('monitored_trips')
    .select('id, user_id, status, confirmed_at, expected_arrival_at, reminder_sent_at')
    .eq('status', 'ativa')
    .is('confirmed_at', null)
    .is('reminder_sent_at', null)
    .lt('expected_arrival_at', agora.toISOString());

  if (error) {
    resumo.erros.push(`busca: ${error.message}`);
    return resumo;
  }

  resumo.verificadas = (corridas || []).length;

  for (const corrida of corridas || []) {
    const acao = decidirAcao(corrida, agora.getTime());
    if (!acao) continue;

    try {
      const payload = JSON.stringify(montarNotificacao(corrida.id));
      await enviarPushParaUsuaria(supabase, corrida.user_id, payload);
      await supabase.from('monitored_trips').update({ reminder_sent_at: agora.toISOString() }).eq('id', corrida.id);
      resumo.perguntas++;
    } catch (erroItem: any) {
      resumo.erros.push(`${corrida.id}: ${erroItem?.message || erroItem}`);
    }
  }

  return resumo;
}

// Só roda o servidor quando o arquivo é EXECUTADO de verdade, nunca quando é
// só importado — mesmo padrão de coletar-fontes/index.ts e
// enviar-alerta-proximidade/index.ts: permite testar decidirAcao isolada,
// com dado simulado, sem precisar de Deno nem chamar o Supabase/Web Push.
if (import.meta.main) {
Deno.serve(async (req: Request) => {
  const segredoEsperado = Deno.env.get('VERIFICAR_SECRET');
  const segredoRecebido = req.headers.get('x-verificar-secret') || '';
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  webpush.setVapidDetails('mailto:contato@rotasegura.app', vapidPublica, vapidPrivada);

  try {
    const resumo = await verificarTudo(supabase);
    return new Response(JSON.stringify(resumo), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (erro) {
    console.error('Falha geral ao verificar corridas:', erro);
    return new Response(JSON.stringify({ erro: 'Falha ao verificar. Veja os logs da função.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
}
