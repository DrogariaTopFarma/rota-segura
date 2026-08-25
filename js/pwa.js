/* ============================================================================
   ROTA SEGURA — Registro do Service Worker (app instalável + offline)

   Só isso: registra sw.js (na raiz do site) uma vez por página. O próprio
   arquivo cuida de tudo (cache do app, alertas push) — aqui não tem lógica
   nenhuma além de "existe suporte? então registra".

   Chame com o caminho relativo até sw.js a partir da página atual (mesma
   pasta que js/push.js usa pro mesmo arquivo): 'sw.js' se a página está na
   raiz (index.html), '../sw.js' se está em pages/*.html.
   ============================================================================ */
export function registrarServiceWorker(caminho) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(caminho).catch((erro) => {
    console.error('Falha ao registrar Service Worker:', erro);
  });
}
