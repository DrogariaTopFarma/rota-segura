# Como configurar os alertas de segurança por notificação push

Passo a passo pra ligar de vez a funcionalidade "Avisar quando surgir um relato
perto de mim" (checkbox na Tela 1 — Mapa). Diferente de tudo que já existe no
app, isso avisa a pessoa **mesmo com o site fechado**: quando um relato novo é
aprovado, ou uma notícia pública vira confiável, o próprio Supabase dispara
uma notificação push pra quem estiver com o alerta ligado perto daquele ponto.

## O que já está pronto no código (nada a fazer aqui)

- `sql/schema.sql` — tabela `push_subscriptions` (seção 18).
- `sw.js` (raiz do site) — recebe a notificação e mostra ela.
- `js/push.js` — pede permissão, assina a Push API do navegador, liga o
  checkbox da Tela 1.
- `js/config.js` — já tem a chave `VAPID_PUBLIC_KEY` preenchida (não é
  secreta, pode ficar no código).
- `supabase/functions/enviar-alerta-proximidade/index.ts` — a função que
  manda a notificação de verdade.

## O que só você consegue fazer

### 1. Rodar o `sql/schema.sql` de novo

Se você já colou o schema completo recentemente (depois da tabela 18 ter sido
adicionada), pode pular este passo. Senão: SQL Editor do Supabase → cola o
arquivo inteiro → Run.

### 2. Publicar a Edge Function

Dashboard do Supabase → **Edge Functions** → **Deploy a new function** → **Via
Editor** → nome: `enviar-alerta-proximidade` → cola o arquivo
`supabase/functions/enviar-alerta-proximidade/index.ts` inteiro → Deploy.

### 3. Configurar os secrets desta função

Dashboard → Edge Functions → `enviar-alerta-proximidade` → **Secrets** →
adicione os três:

- Nome: `ALERTA_SECRET` — valor: uma senha inventada por você (mesmo
  princípio do `COLETA_SECRET` já usado em `coletar-fontes`) — anote em
  algum lugar, você vai precisar dela nos dois webhooks do passo 5.
- Nome: `VAPID_PUBLIC_KEY` — valor:
  `BPtuvvldLgDai3ervwpJ7lJ349s9rOggI2nVaq8Uul8fvDeMhibxE8yMy_81XLhk3najJlvYvuwV-k3aIlvyBio`
  (a mesma chave que já está em `js/config.js` — não é secreta, mas a
  função precisa dela dos dois lados).
- Nome: `VAPID_PRIVATE_KEY` — valor:
  `vbhBjDv1VFdahalnhE32WZ1ig17iyumrw73PEWxCuII`
  **Essa sim é sensível de verdade** — nunca cole ela em nenhum arquivo
  deste repositório, só aqui como secret.

> Os dois valores VAPID acima foram gerados uma vez (par de chaves ECDSA
> P-256, o algoritmo padrão do protocolo Web Push) especificamente pra este
> projeto — não vêm de nenhuma conta externa, você não precisa (nem deveria)
> trocar por outro valor a não ser que quisesse gerar um par novo.

### 4. Ícone da notificação (opcional, já existe um básico)

`assets/icone-192.png` já existe no projeto (um ícone simples na cor de marca
do app) — a notificação usa ele automaticamente. Se quiser um ícone mais
bonito, é só substituir esse arquivo por um PNG 192×192 de verdade.

### 5. Configurar os Database Webhooks (o passo que faz tudo funcionar)

Isso é o que dispara a função sozinha quando um relato/notícia novo aparece —
só dá pra configurar pelo painel, não tem como colocar no `schema.sql`.

No painel atual do Supabase, esse recurso não fica dentro de "Database" —
fica em **Integrations → Database Webhooks**:

1. Dashboard → **Integrations** (menu lateral) → procure/clique em
   **Database Webhooks** (aparece com o selo "OFFICIAL").
2. Se ainda não estiver instalado, clique em **Install integration**
   (canto superior direito) — isso habilita a extensão `pg_net`, exigida
   pelo recurso.
3. Clique na aba **Webhooks** (ao lado de "Overview") → **Create a new
   hook**. Repita **duas vezes**, uma pra cada tabela:

**Webhook 1 — relatos de usuária:**
- Name: `alerta_novo_relato` (sem espaço)
- Table: `reports`
- Events: marque só **Insert**
- Type of webhook: **Supabase Edge Functions** (não "HTTP Request" — essa
  opção já preenche sozinha o cabeçalho `Authorization` que o "portão de
  entrada" do Supabase exige, evitando o mesmo problema que já deu trabalho
  na coleta de fontes)
  - Method: `POST`
  - Select which edge function to trigger: **`enviar-alerta-proximidade`**
  - Timeout: pode deixar o padrão (5000ms)
  - HTTP Headers: **não mexa** em `Content-type`/`Authorization` (o Supabase
    já preencheu certo) — clique em **"Add header"** e adicione mais um:
    `x-alerta-secret` → o mesmo valor do secret `ALERTA_SECRET` do passo 3
- Create webhook

**Webhook 2 — notícias públicas:**
- Mesma coisa, mas Table: `external_incidents`, Events: só **Insert**, mesma
  Edge Function, mesmo cabeçalho `x-alerta-secret`.

> ⚠️ Só **Insert** nas duas — não marque Update nem Delete. `reports` só
> muda de status raramente (moderação) e `external_incidents` é atualizada
> pela própria coleta automática (expiração) de um jeito que não deveria
> gerar alerta de novo.

### Como testar se deu certo

1. Abra a Tela 1 (Mapa), marque o checkbox **"Avisar quando surgir um relato
   perto de mim"** — o navegador vai pedir permissão de notificação, aceite.
2. Registre um relato de teste perto de onde você está (formulário normal do
   app) — se está tudo certo, uma notificação deve aparecer em alguns
   segundos, mesmo com a aba em segundo plano.
3. Se não aparecer nada, confira nesta ordem:
   - **Logs da Edge Function** (Dashboard → Edge Functions →
     `enviar-alerta-proximidade` → Logs) — mostra se a função foi chamada,
     quantos "candidatos" (assinaturas próximas) achou e se deu erro.
   - **Integrations → Database Webhooks → aba Webhooks** — clique no
     webhook e veja o histórico de chamadas (confirma se o Supabase sequer
     tentou chamar a função).
   - Confira se os três secrets (`ALERTA_SECRET`, `VAPID_PUBLIC_KEY`,
     `VAPID_PRIVATE_KEY`) estão certos e sem espaço a mais.

## Limites — o que é honesto esperar disto

- **Não é rastreamento contínuo em segundo plano.** Nenhum navegador deixa
  um site saber sua localização o tempo todo, mesmo fechado — a "área de
  interesse" salva é sua última localização conhecida (atualizada toda vez
  que você abre o Mapa com o GPS ligado), não um ponto que se move sozinho
  enquanto você anda por aí com o site fechado.
- **iPhone/iOS**: notificação push em site (sem ser um app da App Store) só
  funciona depois de "Adicionar à Tela de Início" (a partir do iOS 16.4) —
  isso é uma limitação da própria Apple, não deste código. Testando direto
  pelo Safari normal (aba do navegador), o pedido de permissão nem aparece
  — não é bug, é a Apple bloqueando de propósito. Passo certo no iPhone:
  1. Abra o site no Safari (não em outro navegador — só o Safari instala).
  2. Toque no ícone de **compartilhar** (o quadrado com uma seta pra cima),
     na barra de baixo.
  3. Role e toque em **"Adicionar à Tela de Início"** → **Adicionar**.
  4. Abra o app pelo **ícone que apareceu na tela de início** (não mais
     pelo Safari) — só rodando assim é que o pedido de permissão de
     notificação funciona.
- **Precisa de HTTPS.** Funciona no GitHub Pages (já é HTTPS) e em
  `http://localhost` durante teste local — não funciona testando com o
  arquivo aberto direto (`file://`) nem num IP puro sem HTTPS.
- **Não testei o envio de ponta a ponta de verdade** (preciso de um
  navegador real inscrito e do projeto publicado com HTTPS pra isso) — o
  que testei foi a parte que dá pra testar sem esses dois: a lógica de
  distância/filtro e o texto da notificação, isoladamente, com dado
  simulado. A biblioteca que faz o envio (`web-push`, importada via
  `npm:web-push` — mesmo jeito que este projeto já importa
  `@supabase/supabase-js`) é a mais usada do mundo pra isso, mas o teste
  real — ligar o alerta, criar um relato de verdade, ver a notificação
  aparecer — só você consegue fazer.
