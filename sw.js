/* ============================================================================
   ROTA SEGURA — Service Worker (alertas de segurança por notificação push)

   Único propósito deste arquivo: receber uma notificação push (mandada pela
   Edge Function `enviar-alerta-proximidade` quando um relato/notícia novo
   aparece perto de você) e mostrar ela, mesmo com o site fechado — e abrir
   o Mapa quando a pessoa toca na notificação.

   Fica na RAIZ do site (não em js/) de propósito: o "escopo" de um Service
   Worker é a pasta onde ele mora e tudo abaixo dela — na raiz, cobre o site
   inteiro (index.html e pages/*.html). Se morasse em js/, só controlaria
   páginas dentro de js/ (nenhuma).

   Não faz cache de nada (não é o objetivo aqui, é só o alerta) — se um dia
   quiser o site funcionando offline, isso entra depois, à parte.
   ============================================================================ */

self.addEventListener('push', (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = { title: 'Rota Segura', body: evento.data ? evento.data.text() : '' };
  }

  const titulo = dados.title || 'Alerta de segurança perto de você';
  const opcoes = {
    body: dados.body || '',
    // Ícone reaproveitado do próprio app — nenhum arquivo novo de imagem.
    icon: 'assets/icone-192.png',
    badge: 'assets/icone-192.png',
    data: { url: dados.url || 'pages/mapa.html' },
    tag: dados.tag || 'rota-segura-alerta'
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(evento.notification.data?.url || 'pages/mapa.html', self.location).href;

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      const jaAberta = janelas.find((j) => j.url === destino);
      if (jaAberta) return jaAberta.focus();
      return self.clients.openWindow(destino);
    })
  );
});
