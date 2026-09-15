# Como configurar os alertas de segurança por notificação push

Este guia documenta **duas** funcionalidades que usam a mesma base técnica
(notificação push + as mesmas duas chaves VAPID) — configure a Parte 1
primeiro, a Parte 2 reaproveita quase tudo dela.

- **Parte 1**: "Avisar quando surgir um relato perto de mim" (checkbox na
  Tela 1 — Mapa).
- **Parte 2**: "Acompanhar corrida" (Uber/99, Tela 2 — Rotas) — lembrete de
  chegada com escalonamento.

## Parte 1 — Alerta de proximidade

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

## Parte 2 — Acompanhar corrida (Uber/99)

"Acompanhar corrida" (Tela 2 — Rotas) não lê o GPS de dentro do Uber/99 — não
existe API pública que deixe um app terceiro observar uma corrida alheia (as
APIs oficiais das duas são pra empresa que PEDE a corrida pela API, não pra
observar uma que a própria usuária já chamou no app normal dela). Em vez
disso: ela cola o link de "compartilhar corrida" que o próprio Uber/99 já
gera, define o horário esperado de chegada, e 5 minutos depois do prazo
vencer sem confirmação, o app pergunta "Está tudo bem?" — ela mesma decide
ali, tocando "Sim" ou "Não, avisar meu contato". **Isso é uma camada de
lembrete/tranquilidade, nunca um substituto de ligar pra 190** — o app nunca avisa o contato de emergência
sozinho (ele não é usuária do app, não tem assinatura de push), só lembra a
própria usuária de fazer isso com um toque.

### O que já está pronto no código (nada a fazer aqui)

- `sql/schema.sql` — tabela `monitored_trips` (seção 19).
- `pages/rotas.html` + `js/carona.js` + `css/carona.css` — a tela inteira.
- `js/emergency.js` — `obterLinkDeConfirmacaoAtrasada`, reaproveitando o
  mesmo mecanismo de WhatsApp do botão SOS.
- `supabase/functions/verificar-corridas/index.ts` — a função que verifica
  os prazos e manda a notificação "Está tudo bem?".

### 1. Rodar o `sql/schema.sql` de novo

Se você já rodou o schema depois da tabela 19 (`monitored_trips`) ter sido
adicionada, pode pular este passo.

### 2. Publicar a Edge Function

Mesmo processo de sempre: Dashboard → **Edge Functions** → **Deploy a new
function** → **Via Editor** → nome: `verificar-corridas` → cola o arquivo
`supabase/functions/verificar-corridas/index.ts` inteiro → Deploy.

### 3. Configurar os secrets desta função

Dashboard → Edge Functions → `verificar-corridas` → **Secrets**:

- Nome: `VERIFICAR_SECRET` — valor: uma senha inventada por você (mesmo
  princípio do `ALERTA_SECRET`/`COLETA_SECRET` das outras funções) — não
  precisa ser igual às outras, pode ser uma nova.
- Nome: `VAPID_PUBLIC_KEY` — **o mesmo valor** já usado na Parte 1:
  `BPtuvvldLgDai3ervwpJ7lJ349s9rOggI2nVaq8Uul8fvDeMhibxE8yMy_81XLhk3najJlvYvuwV-k3aIlvyBio`
- Nome: `VAPID_PRIVATE_KEY` — **o mesmo valor** já usado na Parte 1:
  `vbhBjDv1VFdahalnhE32WZ1ig17iyumrw73PEWxCuII`

> Edge Function não compartilha secret entre funções — mesmo sendo os
> mesmos valores da Parte 1, precisa colar de novo aqui. Não gere um par
> VAPID novo, é o mesmo par pras duas funcionalidades.

### 4. Desligar a exigência de JWT nesta função (passo obrigatório)

Mesmo motivo de `coletar-fontes` (ver `COMO_CONFIGURAR_COLETA_RJ.md`, seção
8.1.1): o `pg_net` não consegue mandar o cabeçalho `Authorization` no
formato que o "portão de entrada" do Supabase exige. Como a função já tem a
própria autorização (`x-verificar-secret`), essa exigência é redundante:

1. Dashboard → **Edge Functions** → `verificar-corridas` → aba **Settings**.
2. Ache **"Enforce JWT Verification"** → desligue → Salve.

### 5. Agendar (pg_cron) — mesmo padrão de `coletar-fontes`

Diferente da Parte 1 (que é disparada por Database Webhook, num evento),
isso é baseado em TEMPO (prazo vencendo) — o mecanismo certo é pg_cron, não
webhook. Se você já configurou `pg_cron`/`pg_net` pra `coletar-fontes`, as
extensões já estão habilitadas — pule pro SQL abaixo. Senão, siga
`COMO_CONFIGURAR_COLETA_RJ.md`, seção 8.1, primeiro.

No **SQL Editor**, guarde a chave e a senha no Vault (mesmo bloco idempotente
de sempre — funciona rodar de novo mesmo se já existir):

```sql
do $$
begin
  if exists (select 1 from vault.secrets where name = 'verificar_corridas_apikey') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'verificar_corridas_apikey'),
      'SUA_CHAVE_SB_SECRET_AQUI'
    );
  else
    perform vault.create_secret('SUA_CHAVE_SB_SECRET_AQUI', 'verificar_corridas_apikey');
  end if;

  if exists (select 1 from vault.secrets where name = 'verificar_corridas_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'verificar_corridas_secret'),
      'SUA_VERIFICAR_SECRET_AQUI'
    );
  else
    perform vault.create_secret('SUA_VERIFICAR_SECRET_AQUI', 'verificar_corridas_secret');
  end if;
end $$;
```

> `SUA_CHAVE_SB_SECRET_AQUI` é a chave `sb_secret_...` do seu projeto
> (Project Settings → API Keys — a mesma usada em `coletar-fontes`).
> `SUA_VERIFICAR_SECRET_AQUI` é o valor do secret `VERIFICAR_SECRET` do
> passo 3. Não deixe este SQL salvo em nenhum arquivo depois de rodar.

Depois, em uma query nova (esta não tem valor sensível, pode guardar):

```sql
select cron.schedule(
  'verificar-corridas-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://rmggyqqmhupkabgwmnzv.supabase.co/functions/v1/verificar-corridas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'verificar_corridas_apikey'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'verificar_corridas_apikey'),
      'x-verificar-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'verificar_corridas_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

### Como testar se deu certo

```sql
select * from cron.job where jobname = 'verificar-corridas-5min';
```
Deve mostrar `active = true`.

Pra testar de ponta a ponta sem esperar uma corrida atrasar de verdade:
1. Na Tela 2, comece a acompanhar uma corrida com horário de chegada 1
   minuto no futuro.
2. Espere passar o horário em pelo menos 5 minutos (é o
   `MINUTOS_APOS_PRAZO_PARA_PERGUNTAR` configurado no topo da função) — mais
   até 5 minutos do próximo tick do cron. No pior caso, uns 10 minutos.
3. Deve chegar UMA notificação "Está tudo bem?" — só essa, não tem uma
   segunda depois; a partir daí é você quem decide (confirmar ou avisar seu
   contato) tocando na notificação.
4. Se não chegar, confira **Edge Functions → verificar-corridas → Logs**, e
   `select * from cron.job_run_details order by start_time desc limit 5;`
   (mesmo comando de diagnóstico já usado pra `coletar-fontes`).

## Limites — o que é honesto esperar disto

As duas funcionalidades desta página compartilham a mesma base (Web Push) e
os mesmos limites abaixo:

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
- **Específico do "Acompanhar corrida": não é um sistema que avisa o contato
  de emergência sozinho.** O app nunca manda mensagem pro contato sem a
  usuária tocar em algo — ele não é usuária do app, não tem assinatura de
  push, só telefone cadastrado. O máximo que a função `verificar-corridas`
  faz é lembrar A PRÓPRIA usuária (por push) de confirmar que chegou bem ou
  de avisar o contato ela mesma. Isso é intencional e está escrito na tela:
  em perigo real e imediato, ligar pra 190 continua sendo mais rápido e mais
  confiável do que qualquer lembrete de app.
