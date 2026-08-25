/* ============================================================================
   ROTA SEGURA — Service Worker + instalação do app

   Duas coisas, sem se misturar:
   1. registrarServiceWorker: registra sw.js (na raiz do site) uma vez por
      página. O próprio arquivo cuida de tudo (cache do app, alertas push)
      — aqui não tem lógica nenhuma além de "existe suporte? então registra".
   2. ligarBotaoInstalarApp: o botão "Baixar app" do menu. Chrome/Android/
      Edge deixam a gente pedir a instalação por código de verdade (captura
      o evento beforeinstallprompt e dispara na hora que a pessoa clica) —
      Safari/iOS e a maioria dos outros navegadores NÃO deixam (a Apple não
      implementa esse evento de propósito), então nesses casos o botão abre
      um modal com o passo manual em vez de fingir que instalou.

   Chame registrarServiceWorker com o caminho relativo até sw.js a partir da
   página atual: 'sw.js' se a página está na raiz (index.html), '../sw.js'
   se está em pages/*.html.
   ============================================================================ */

import { abrirModal } from './ui.js';

export function registrarServiceWorker(caminho) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(caminho).catch((erro) => {
    console.error('Falha ao registrar Service Worker:', erro);
  });
}

// Só existe em navegadores baseados em Chromium (Chrome, Edge, navegadores
// Android em geral) — o evento chega em algum momento depois do carregamento
// da página, então pode não ter chegado ainda se a pessoa clicar "Baixar
// app" bem rápido; nesse caso cai no modal manual também, sem travar nada.
let promptAdiado = null;
window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  promptAdiado = evento;
});

/** App já está rodando instalado (aberto pelo ícone, não pelo navegador)? —
    usado pra esconder o botão "Baixar app": não faz sentido oferecer de
    novo. `navigator.standalone` é a forma específica do Safari/iOS de
    responder a mesma pergunta (não suporta a media query padrão). */
function appJaInstalado() {
  return (window.matchMedia?.('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

/** Liga o botão "Baixar app" do menu (mesmo id nas três páginas que têm
    menu: mapa.html, alertas.html, perfil.html). Esconde sozinho se o app já
    estiver instalado; senão, usa o prompt nativo quando disponível ou abre
    o modal de instruções manuais (#modal-baixar-app, mesmas três páginas). */
export function ligarBotaoInstalarApp() {
  const botao = document.getElementById('menu-baixar-app');
  if (!botao) return;

  if (appJaInstalado()) {
    botao.hidden = true;
    return;
  }

  botao.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!promptAdiado) {
      abrirModal('modal-baixar-app');
      return;
    }
    promptAdiado.prompt();
    await promptAdiado.userChoice;
    promptAdiado = null;
  });
}
