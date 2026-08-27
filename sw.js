/* ============================================================================
   ROTA SEGURA — Service Worker

   Duas responsabilidades, sem se misturar:
   1. Alertas de segurança por notificação push (evento 'push' /
      'notificationclick') — o motivo original deste arquivo existir.
   2. App instalável ("Adicionar à tela de início") + funciona sem internet
      pro que já foi carregado antes (evento 'install' / 'activate' /
      'fetch') — cache só do "esqueleto" do app (HTML/CSS/JS), NUNCA dos
      dados do Supabase: relato, notícia, rota etc. sempre exigem rede de
      verdade, porque mostrar um dado de segurança desatualizado sem avisar
      que está desatualizado seria pior que não mostrar nada.

   VERSIONAMENTO DO CACHE: troque CACHE_VERSION toda vez que este arquivo
   (ou a lista ARQUIVOS_DO_APP) mudar. Sem isso, quem já instalou o app
   ficaria preso pra sempre na versão antiga do código — o 'activate' abaixo
   apaga qualquer cache de versão anterior automaticamente.
   ============================================================================ */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `rota-segura-${CACHE_VERSION}`;

const ARQUIVOS_DO_APP = [
  'index.html',
  'manifest.json',
  'css/variables.css', 'css/global.css', 'css/components.css', 'css/auth.css',
  'css/map.css', 'css/rotas.css', 'css/comunidade.css', 'css/perfil.css', 'css/responsive.css',
  'js/config.js', 'js/supabase.js', 'js/auth.js', 'js/map.js', 'js/geolocation.js',
  'js/geocoding.js', 'js/location-picker.js', 'js/search.js', 'js/reports.js',
  'js/support-points.js', 'js/routes.js', 'js/navigation.js', 'js/voice.js', 'js/push.js',
  'js/pwa.js', 'js/risco-horario.js', 'js/emergency.js', 'js/community.js', 'js/alertas.js', 'js/profile.js',
  'js/notifications.js', 'js/nav.js', 'js/ui.js', 'js/icons.js', 'js/app.js',
  'pages/login.html', 'pages/cadastro.html', 'pages/recuperar-senha.html', 'pages/nova-senha.html',
  'pages/mapa.html', 'pages/rotas.html', 'pages/alertas.html', 'pages/perfil.html', 'pages/termos.html',
  'assets/icone-192.png', 'assets/icone-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll falha tudo se UM arquivo faltar (ex.: 404) — cada arquivo é
      // colocado em cache individualmente pra um problema num só não
      // impedir o resto do app de instalar.
      Promise.all(
        ARQUIVOS_DO_APP.map((caminho) =>
          cache.add(caminho).catch((erro) => console.warn('Não coloquei em cache:', caminho, erro))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  // Só GET, só do próprio site — nunca intercepta chamada pro Supabase (API,
  // Storage, Auth) nem pra qualquer outro domínio (Photon, OpenRouteService,
  // fontes de tile do mapa etc.). Essas sempre precisam de rede de verdade;
  // fingir uma resposta em cache pra elas seria mostrar dado de segurança
  // desatualizado sem avisar.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Rede primeiro, cache como último recurso: numa conexão normal, sempre
  // pega a versão mais nova do app (evita o problema clássico de PWA
  // "atualizei o código mas o celular da usuária continua preso na versão
  // velha") — o cache só entra quando a rede falha de verdade (sem sinal).
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req))
  );
});

/* ---------------------------------------------------------------------- */
/* Alertas de segurança por notificação push (ver COMO_CONFIGURAR_ALERTAS.md) */
/* ---------------------------------------------------------------------- */

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

  evento.waitUntil(
    Promise.all([
      self.registration.showNotification(titulo, opcoes),
      // Se o app estiver aberto (em especial navegando, Tela 2), avisa a
      // página direto — é o que deixa navigation.js falar o alerta em voz
      // alta na hora, além da notificação do sistema (útil andando, com o
      // celular no bolso: você ESCUTA sem precisar olhar a tela).
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
        clientes.forEach((cliente) => cliente.postMessage({ tipo: 'alerta-proximidade', title: titulo, body: opcoes.body }));
      })
    ])
  );
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
