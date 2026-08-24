/* ============================================================================
   ROTA SEGURA — Alertas de segurança por notificação push

   Diferente de tudo que já existe no app: isso avisa a pessoa mesmo com o
   site FECHADO. Quando um relato novo é aprovado, ou uma notícia pública
   vira confiável, a Edge Function `enviar-alerta-proximidade` (disparada
   por um Database Webhook — configuração de painel, ver
   COMO_CONFIGURAR_ALERTAS.md) manda uma notificação push pra quem estiver
   com o alerta ligado perto daquele ponto. Este arquivo só cuida do lado do
   navegador: pedir permissão, assinar a Push API e guardar/atualizar a
   "área de interesse" (última localização conhecida) no Supabase.

   Não existe rastreamento contínuo em segundo plano — nenhum site consegue
   isso de verdade. A "área de interesse" é atualizada sempre que a pessoa
   liga o alerta ou abre o Mapa com o alerta já ligado (ver
   ligarFiltroDeAlertasProximidade em app.js).

   Caminho do Service Worker (`../sw.js`) é relativo à página que chama este
   módulo — hoje só é usado a partir de pages/mapa.html (um nível abaixo da
   raiz). Se um dia for chamado de outro lugar, ajuste o caminho.
   ============================================================================ */

import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from './config.js';
import { toast } from './ui.js';

const CHAVE_PREFERENCIA = 'rota-segura:alertas-proximidade';
const CAMINHO_SW = '../sw.js';

function base64UrlParaUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64);
  const saida = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) saida[i] = bruto.charCodeAt(i);
  return saida;
}

export function alertasSuportados() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function alertasLigados() {
  return localStorage.getItem(CHAVE_PREFERENCIA) === 'ligado';
}

/** Liga os alertas: pede permissão do navegador, assina a Push API e salva
    a assinatura + localização atual no Supabase. Se qualquer passo falhar
    ou for negado, a preferência NUNCA fica marcada como "ligada" sem uma
    assinatura de verdade por trás — evita o checkbox mentir sobre o estado
    real. Devolve true/false (sucesso). */
export async function ligarAlertas(lat, lng) {
  if (!alertasSuportados()) {
    toast('Este navegador não suporta notificações push.', 'erro');
    return false;
  }

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    toast('Sem permissão de notificação, não dá pra ligar os alertas.', 'atencao');
    return false;
  }

  try {
    const registro = await navigator.serviceWorker.register(CAMINHO_SW);
    await navigator.serviceWorker.ready;

    let assinatura = await registro.pushManager.getSubscription();
    if (!assinatura) {
      assinatura = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlParaUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const { data: sessao } = await supabase.auth.getUser();
    const user = sessao?.user;
    if (!user) return false;

    const chaves = assinatura.toJSON().keys;
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: assinatura.endpoint,
        p256dh: chaves.p256dh,
        auth: chaves.auth,
        lat: lat ?? null,
        lng: lng ?? null
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;

    localStorage.setItem(CHAVE_PREFERENCIA, 'ligado');
    return true;
  } catch (erro) {
    console.error('Falha ao ligar alertas:', erro);
    toast('Não foi possível ligar os alertas agora. Tente de novo.', 'erro');
    return false;
  }
}

/** Desliga: cancela a assinatura no navegador E apaga a linha no banco — só
    apagar uma das duas deixaria uma assinatura órfã (o navegador esqueceu,
    mas o banco ainda tentaria mandar notificação pra ela) ou o inverso
    (navegador ainda inscrito, mas a Edge Function nunca mais o encontra). */
export async function desligarAlertas() {
  localStorage.setItem(CHAVE_PREFERENCIA, 'desligado');
  if (!('serviceWorker' in navigator)) return;
  try {
    const registro = await navigator.serviceWorker.getRegistration(CAMINHO_SW);
    const assinatura = await registro?.pushManager.getSubscription();
    if (assinatura) {
      const endpoint = assinatura.endpoint;
      await assinatura.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
  } catch (erro) {
    console.error('Falha ao desligar alertas:', erro);
  }
}

/** Só atualiza a localização de uma assinatura JÁ existente (não pede
    permissão nem cria assinatura nova) — chamado quando a pessoa abre o
    Mapa com o alerta já ligado, pra manter a área de interesse atual. */
export async function atualizarLocalizacaoDoAlerta(lat, lng) {
  if (!alertasLigados() || !alertasSuportados() || lat == null || lng == null) return;
  try {
    const registro = await navigator.serviceWorker.getRegistration(CAMINHO_SW);
    const assinatura = await registro?.pushManager.getSubscription();
    if (!assinatura) return;
    await supabase.from('push_subscriptions')
      .update({ lat, lng })
      .eq('endpoint', assinatura.endpoint);
  } catch (erro) {
    console.error('Falha ao atualizar localização do alerta:', erro);
  }
}

/** Liga o checkbox "Avisar quando surgir um relato perto de mim"
    (pages/mapa.html). `obterPosicaoAtual` é uma função (não um valor) —
    chamada só na hora de ligar o alerta, pra pegar a posição mais recente
    disponível naquele momento, não a de quando a página abriu. */
export function ligarFiltroDeAlertasProximidade(obterPosicaoAtual) {
  const caixa = document.getElementById('filtro-alertas-proximidade');
  if (!caixa) return;

  if (!alertasSuportados()) {
    caixa.disabled = true;
    return;
  }

  caixa.checked = alertasLigados();

  caixa.addEventListener('change', async () => {
    if (caixa.checked) {
      const pos = obterPosicaoAtual?.();
      const ok = await ligarAlertas(pos?.lat, pos?.lng);
      caixa.checked = ok;
      if (ok) toast('Alertas de segurança perto de você ligados.', 'sucesso');
    } else {
      await desligarAlertas();
    }
  });
}

/** Mantém a área de interesse atualizada com a posição mais recente — chame
    isto sempre que uma leitura de GPS nova chegar (ex.: dentro do mesmo
    listener que já recarrega os dados da área visível). Não faz nada se os
    alertas estiverem desligados ou a posição ainda não tiver chegado. */
export function acompanharLocalizacaoDoAlerta(obterPosicaoAtual) {
  if (!alertasLigados()) return;
  const pos = obterPosicaoAtual?.();
  if (pos) atualizarLocalizacaoDoAlerta(pos.lat, pos.lng);
}
