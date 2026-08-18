/* ============================================================================
   ROTA SEGURA — Central de notificações (Bloco 3)
   Um modal (mesmo padrão de modal-menu/modal-cadastrar), não uma página nova.
   Só existem notificações reais: hoje, a única fonte automática é o gatilho
   do banco que avisa quando alguém curte sua publicação (ver schema.sql,
   notificar_curtida). Não inventamos notificações pra tela não ficar vazia.
   ============================================================================ */

import { supabase } from './supabase.js';
import { icone } from './icons.js';
import { abrirModal, escapar, formatarDataHora, htmlEstadoVazio, htmlCarregando, toast } from './ui.js';
import { atualizarBadgeNotificacoes } from './nav.js';

const ROTULOS_TIPO = {
  info: 'Interação',
  alerta: 'Alerta',
  moderacao: 'Moderação',
  sistema: 'Sistema'
};

async function carregarNotificacoes() {
  const lista = document.getElementById('notificacoes-lista');
  if (!lista) return;
  lista.innerHTML = htmlCarregando(3);

  const { data, error } = await supabase
    .from('notifications')
    .select('id,title,body,type,link,is_read,created_at')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    lista.innerHTML = `<div class="mensagem mensagem--erro">Não foi possível carregar suas notificações.</div>`;
    return;
  }

  const notificacoes = data || [];
  if (!notificacoes.length) {
    lista.innerHTML = htmlEstadoVazio('Nenhuma notificação por enquanto.');
    return;
  }

  lista.innerHTML = notificacoes.map((n) => `
    <div class="notificacao${n.is_read ? '' : ' notificacao--nao-lida'}">
      <span class="notificacao__icone">${icone('sino', 18)}</span>
      <div class="notificacao__conteudo">
        <div class="notificacao__linha">
          <strong>${escapar(n.title)}</strong>
          <span class="tag tag--rosa">${escapar(ROTULOS_TIPO[n.type] || 'Aviso')}</span>
        </div>
        ${n.body ? `<div class="notificacao__corpo">${escapar(n.body)}</div>` : ''}
        <div class="notificacao__hora">${escapar(formatarDataHora(n.created_at))}</div>
      </div>
    </div>`).join('');

  // Abrir a central já conta como "ler" as notificações — mesmo comportamento
  // de qualquer central de notificações comum, sem precisar clicar uma a uma.
  const idsNaoLidas = notificacoes.filter((n) => !n.is_read).map((n) => n.id);
  if (idsNaoLidas.length) {
    await supabase.from('notifications').update({ is_read: true }).in('id', idsNaoLidas);
    await atualizarBadgeNotificacoes();
  }
}

/** Apaga todas as notificações da usuária (não só as 30 carregadas na tela),
    pra não ficarem se acumulando pra sempre. RLS já garante que só apaga as
    dela — o `.not('id','is',null)` é só o filtro exigido pelo Supabase pra
    aceitar um delete em massa. */
async function limparNotificacoes() {
  const { error } = await supabase.from('notifications').delete().not('id', 'is', null);
  if (error) {
    toast('Não foi possível limpar as notificações agora.', 'erro');
    return;
  }
  await carregarNotificacoes();
  await atualizarBadgeNotificacoes();
  toast('Notificações limpas.', 'sucesso');
}

/** Liga o sino do cabeçalho: abre o modal e carrega a lista. */
export function prepararNotificacoes() {
  document.getElementById('botao-notificacoes')?.addEventListener('click', () => {
    abrirModal('modal-notificacoes');
    carregarNotificacoes();
  });
  document.getElementById('btn-limpar-notificacoes')?.addEventListener('click', limparNotificacoes);
}
