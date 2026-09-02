# Como configurar a coleta de fontes públicas (RJ) — Rota Segura

Este guia ativa uma funcionalidade **opcional** do Rota Segura: coletar notícias públicas do Rio
de Janeiro, classificar com IA, cruzar com relatos de usuárias e mostrar no mapa com um selo de
confiança. O resto do app funciona inteiro sem isso — só siga este guia se quiser ativar essa
camada extra.

Parte do zero, como o `GUIA_PASSO_A_PASSO.md` — não presume que você já mexeu nisso antes.

## O que você vai configurar, em ordem

1. Uma tabela nova no banco (`external_incidents`).
2. A Edge Function `coletar-fontes` (o "robô" que coleta e classifica).
3. A chave da IA (Google Gemini) — passo a passo detalhado em `README_AI_SETUP.md`.
4. Uma senha própria (`COLETA_SECRET`) pra só você poder disparar a coleta.
5. O agendamento automático, via pg_cron (dentro do próprio Supabase).
6. Testar cada etapa.

## 1. Rodar o SQL

A tabela `external_incidents` já está no `sql/schema.sql` (seção 16) — é o MESMO arquivo que
você já rodou antes, só que atualizado. Se você já rodou o `schema.sql` alguma vez:

1. Abra o painel do Supabase → **SQL Editor** → **"+ New query"**.
2. Cole o `sql/schema.sql` **inteiro** de novo (não só o pedaço novo) e clique em **Run**.
3. É seguro rodar de novo — o script inteiro foi escrito pra não quebrar nada que já existe
   (só cria o que ainda não existia).

### Como testar se deu certo

Painel do Supabase → **Table Editor** → deve aparecer uma tabela nova chamada
`external_incidents` na lista à esquerda, vazia (0 linhas, por enquanto — ela só recebe dado
depois que a coleta rodar pela primeira vez).

## 2. Publicar a Edge Function `coletar-fontes`

Mesmo processo que você já usou pra `calcular-rota` (Etapa 12 do guia principal):

1. Painel do Supabase → **Edge Functions** → **"Deploy a new function"** → **"Via Editor"**.
2. Nome da função: `coletar-fontes` (exatamente assim, com hífen).
3. Apague o conteúdo de exemplo que aparecer no editor.
4. Abra `supabase/functions/coletar-fontes/index.ts` neste projeto, copie o arquivo **inteiro**
   e cole no editor do Supabase.
5. Clique em **Deploy**.

### Como testar se deu certo

A função deve aparecer na lista de Edge Functions, com status ativo. Ainda não vai funcionar de
verdade até você configurar os secrets (próximos passos) — se disparar agora, vai dar erro
avisando que falta `GEMINI_API_KEY` ou os secrets do Supabase, o que é esperado nesta hora.

## 3. Configurar a chave da IA (Gemini)

Siga **`README_AI_SETUP.md`** inteiro agora — ele explica como criar a conta, gerar a chave e
configurar o secret `GEMINI_API_KEY` nesta mesma função. Volte pra cá depois de terminar.

## 4. Criar sua senha de disparo (`COLETA_SECRET`)

Essa é uma senha que **você inventa** — só serve pra garantir que ninguém além de você (ou do
agendamento automático) consiga chamar a função e gastar sua cota de IA à toa.

1. Invente uma senha longa e aleatória (20+ caracteres, não precisa decorar — pode gerar em
   qualquer gerenciador de senhas, ou só digitar uma sequência aleatória de letras/números).
2. Painel do Supabase → **Edge Functions** → **coletar-fontes** → **Secrets** → adicione:
   - Nome: `COLETA_SECRET`
   - Valor: a senha que você inventou
3. Guarde essa mesma senha — você vai usar de novo no passo 6.

## 5. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` — não precisa fazer nada aqui

Toda Edge Function do Supabase já recebe esses dois secrets **automaticamente**, sozinha — a
função `coletar-fontes` usa eles pra gravar no banco (com permissão pra ignorar o RLS, já que é
um robô, não uma usuária logada).

**Não tente criar esses dois manualmente** — o Supabase reserva o prefixo `SUPABASE_` pra uso
próprio e recusa qualquer secret que você tente criar com esse nome (se aparecer um erro dizendo
que o nome não é aceito, é por isso; não é bug seu). Não tem o que configurar nesta etapa — só
os dois secrets do passo 3 (`GEMINI_API_KEY`) e do passo 4 (`COLETA_SECRET`) precisam ser criados
à mão.

> ⚠️ A chave `service_role` (que já vem pronta em `SUPABASE_SERVICE_ROLE_KEY`) ignora todas as
> regras de segurança do banco (RLS). Ela só existe dentro da Edge Function — nunca coloque essa
> chave em `js/config.js` nem em nenhum arquivo que vá pro GitHub.

## 6. Testar a função manualmente (antes de agendar)

Com `GEMINI_API_KEY` e `COLETA_SECRET` já configurados (o resto vem automático, passo 5), dispare
a função uma vez à mão pra confirmar que tudo funciona antes de agendar:

No terminal (ou em qualquer ferramenta que faça requisição HTTP, como o Postman):

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/coletar-fontes" \
  -H "apikey: SUA_CHAVE_SECRETA_AQUI" \
  -H "Authorization: Bearer SUA_CHAVE_SECRETA_AQUI" \
  -H "x-coleta-secret: SUA_COLETA_SECRET_AQUI" \
  -H "Content-Type: application/json"
```

Troque `SEU-PROJETO` pela URL de verdade do seu projeto, `SUA_COLETA_SECRET_AQUI` pela senha do
passo 4, e `SUA_CHAVE_SECRETA_AQUI` (usada duas vezes) pela chave que começa com `sb_secret_...`
(Project Settings → **API Keys** — **não** é a `sb_publishable_...` que está em `js/config.js`).

> `apikey` e `Authorization` são exigidos pelo próprio "portão de entrada" do Supabase pra
> deixar QUALQUER requisição passar até a função, antes mesmo dela rodar — por isso os dois
> levam a credencial de verdade do Supabase (a chave secreta), não a nossa senha. A nossa senha
> própria (`COLETA_SECRET`) vai num cabeçalho à parte, `x-coleta-secret` — é esse, e só esse,
> que o código da função confere pra decidir se autoriza a coleta. Cuidado ao testar pelo
> terminal do seu computador pra não deixar esse comando salvo em algum lugar com a chave
> secreta dentro.

### Como testar se deu certo

A resposta deve ser um JSON parecido com:

```json
{
  "fontes": {
    "g1_rio_rss": { "encontrados": 20, "processados": 3 },
    "g1_rio_transito_rss": { "encontrados": 8, "processados": 2 },
    "fogo_cruzado": { "encontrados": 16, "processados": 5 }
  },
  "erros": []
}
```

Se você não configurou os secrets `FOGOCRUZADO_EMAIL`/`FOGOCRUZADO_PASSWORD`, é normal
`fogo_cruzado` aparecer como `{ "erro": "FOGOCRUZADO_EMAIL/FOGOCRUZADO_PASSWORD não
configurados" }` em vez de `encontrados`/`processados` — as outras duas fontes continuam
funcionando normalmente.

`encontrados` é quantas notícias o RSS trouxe; `processados` é quantas passaram por TODOS os
filtros (menciona o RJ, a IA confirmou relevância e localização, não é estatística) e foram
gravadas. É normal `processados` ser bem menor que `encontrados` — a maioria das notícias de um
feed geral não é sobre segurança/mobilidade específica de um lugar.

Depois, confira no **Table Editor** → `external_incidents`: devem existir linhas novas.

### Erros mais comuns nesta etapa

| Erro | Causa | Solução |
|---|---|---|
| `{"erro":"Não autorizado."}` | `COLETA_SECRET` errado no cabeçalho `x-coleta-secret`, ou não configurado na função | Confira se o valor do `curl`/secret do GitHub é IGUAL ao salvo no secret da função |
| `{"message":"No API key found in request",...}` (HTTP 401) | Faltou o cabeçalho `apikey` — isso é o "portão de entrada" do Supabase barrando antes de chegar na função | Adicione `-H "apikey: ..."` no comando (ver exemplo acima) |
| `{"message":"Secret API key required",...}` (HTTP 401) | `apikey`/`Authorization` foram enviados com a chave `sb_publishable_...` (ou com a `COLETA_SECRET` no lugar errado) — este projeto exige a `sb_secret_...` nesses dois cabeçalhos | Confira se `apikey` E `Authorization` levam a chave `sb_secret_...`, e se a `COLETA_SECRET` está só no `x-coleta-secret` |
| `{"erro":"GEMINI_API_KEY não configurada..."}` | Esqueceu o passo 3, ou publicou a função antes de adicionar o secret | Adicione o secret e publique a função de novo |
| `processados` sempre 0 | Pode ser normal (poucas notícias relevantes no feed no momento), mas se acontecer em TODA execução, veja os **Logs** — se aparecer `Falha ao classificar com IA: Error: Gemini respondeu 404 ... is no longer available`, é sinal de que o Google descontinuou o modelo configurado | Abra `supabase/functions/coletar-fontes/index.ts`, ache `const modelo = '...'` (dentro de `classificarComIA`) e troque pelo nome de modelo que o próprio erro sugere (ou confira o nome atual em <https://aistudio.google.com/>). Publique a função de novo depois de editar |
| Erro de rede/timeout | RSS do G1 ou a API do Gemini estavam fora do ar na hora | Tente de novo — a função não derruba nada, só aquela execução específica falha |
| Disparando pelo `net.http_post` (seção 8) e `net._http_response.error_msg` mostra `"Timeout of 5000 ms reached"` | O padrão do `pg_net` (5s) é curto demais pra esta função — não é falha da função em si, é o pg_net desistindo de esperar cedo demais | Sempre inclua `timeout_milliseconds := 55000` na chamada (ver seção 8.3/8.5) |

## 7. Ver os logs

Painel do Supabase → **Edge Functions** → **coletar-fontes** → aba **Logs**. Cada execução
imprime o que aconteceu com cada notícia (aceita, rejeitada e por quê, erro específico) — é ali
que você confirma o funcionamento de verdade, não só "sem erro na tela".

## 8. Agendar (pg_cron, dentro do próprio Supabase)

Conferindo os logs reais da Edge Function (Dashboard do Supabase → Edge Functions →
coletar-fontes → aba **Invocations**), o agendamento por GitHub Actions (gatilho `schedule` no
arquivo `.yml`) se mostrou pouco confiável — chegou a passar mais de 11 horas sem disparar
nenhuma chamada, mesmo configurado pra cada 30 minutos. Isso é um limite conhecido do próprio
GitHub, documentado por eles: execuções agendadas atrasam ou são puladas em repositórios com
pouco tráfego, sem garantia de horário. Por isso, quem chama a função no horário certo agora é o
**pg_cron**, uma extensão do próprio banco Postgres do Supabase — nada de site externo, tudo
dentro do projeto que você já usa.

Junto com `pg_cron` (que agenda), usamos `pg_net` (que faz a chamada HTTP de dentro do banco) e o
**Vault** do Supabase (armazenamento criptografado, pra não deixar a chave secreta em texto puro
dentro do agendamento).

### 8.1 Habilitar as extensões

1. Painel do Supabase → **Database** → **Extensions**.
2. Busque `pg_cron` → clique em **Enable**.
3. Busque `pg_net` → clique em **Enable**.

> Se alguma das duas não aparecer na lista, ou o botão vier desabilitado, o plano do seu projeto
> pode não liberar essas extensões — me avise que a gente troca pra um serviço externo de cron
> (cron-job.org, por exemplo) como alternativa.

### 8.1.1 Desligar a exigência de JWT nesta função (passo obrigatório)

Por padrão, o "portão de entrada" do Supabase exige um JWT válido no cabeçalho `Authorization`
antes mesmo de deixar a chamada chegar na função — mas o `pg_net` não consegue mandar isso no
formato que o portão espera (testado ao vivo: dá erro `UNAUTHORIZED_INVALID_JWT_FORMAT`, mesmo
com a chave `sb_secret_...` certa). Como a função **já tem a própria autorização** (o
`x-coleta-secret`, conferido no código), essa exigência de JWT é redundante aqui — só precisa
desligar ela pra esta função específica:

1. Painel do Supabase → **Edge Functions** → **coletar-fontes** → aba **Settings**.
2. Ache **"Enforce JWT Verification"** (ou "Verify JWT") → desligue.
3. Salve.

Isso é seguro: sem a `x-coleta-secret` certa, a função continua recusando com 401 mesmo com essa
opção desligada — é o próprio código dela, não o portão do Supabase, quem decide.

### 8.2 Guardar as chaves no Vault

Isso evita deixar a chave secreta em texto puro dentro do agendamento — só o NOME da chave fica
visível pra quem olhar a lista de tarefas agendadas depois, nunca o valor.

No **SQL Editor** → **"+ New query"**, cole e rode (trocando os dois valores de exemplo pelos
seus reais: a chave `sb_secret_...` do passo 6, e a sua `COLETA_SECRET` do passo 4). Este bloco
funciona não importa se você já rodou isso antes — cria o segredo se ele ainda não existe, ou
atualiza o valor se já existir (`vault.create_secret` sozinho dá erro de "já existe" numa segunda
tentativa; este bloco evita esse problema):

```sql
do $$
begin
  if exists (select 1 from vault.secrets where name = 'coleta_fontes_apikey') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'coleta_fontes_apikey'),
      'SUA_CHAVE_SB_SECRET_AQUI'
    );
  else
    perform vault.create_secret('SUA_CHAVE_SB_SECRET_AQUI', 'coleta_fontes_apikey');
  end if;

  if exists (select 1 from vault.secrets where name = 'coleta_fontes_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'coleta_fontes_secret'),
      'SUA_COLETA_SECRET_AQUI'
    );
  else
    perform vault.create_secret('SUA_COLETA_SECRET_AQUI', 'coleta_fontes_secret');
  end if;
end $$;
```

> ⚠️ Rode este SQL direto no SQL Editor, com os valores reais no lugar dos `SUA_..._AQUI`.
> **Não salve esse texto com os valores preenchidos em nenhum arquivo deste projeto** (nem no
> `schema.sql`) — assim que você roda, o Supabase já guarda o valor de forma criptografada;
> depois disso é só fechar a aba sem guardar o SQL em lugar nenhum.

### 8.3 Criar o agendamento

Ainda no SQL Editor, em uma query nova:

```sql
select cron.schedule(
  'coletar-fontes-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://rmggyqqmhupkabgwmnzv.supabase.co/functions/v1/coletar-fontes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_apikey'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_apikey'),
      'x-coleta-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

Esta query **não tem nenhum valor sensível dentro** (só os nomes salvos no Vault no passo
anterior) — pode rodar, guardar ou repetir sem risco.

> ⚠️ **`timeout_milliseconds := 55000`**: o padrão do `pg_net` é só **5000** (5 segundos) — curto
> demais pra esta função, que faz RSS + Fogo Cruzado + classifica cada item novo com IA (um por
> vez, não em paralelo). Testado ao vivo: sem esse parâmetro, `net._http_response.error_msg`
> mostra `"Timeout of 5000 ms reached"` e a coleta nunca grava nada, mesmo funcionando por
> completo no lado do servidor — o pg_net só desiste de esperar a resposta antes dela chegar.
> Se mesmo com 55s ainda acontecer (visível pelo mesmo teste do `error_msg`), reduza
> `MAX_ITENS_POR_EXECUCAO` no topo de `coletar-fontes/index.ts` (menos itens por fonte a cada
> execução = execução mais rápida) e publique a função de novo.

### Como testar se deu certo

```sql
select * from cron.job;
```
Deve aparecer uma linha com `jobname = coletar-fontes-30min` e `active = true`.

Depois de esperar alguns minutos (ou usando o disparo manual da seção 8.5 abaixo, pra não
esperar):

```sql
select * from cron.job_run_details order by start_time desc limit 5;
```
Mostra o resultado de cada execução — `status = succeeded` é o esperado. Se vier `failed`, a
coluna `return_message` costuma indicar o motivo. Confirme também no Dashboard: Edge Functions →
coletar-fontes → **Invocations** — deve aparecer uma chamada nova, com status 200.

### 8.4 Se precisar trocar a `COLETA_SECRET` depois

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'coleta_fontes_secret'),
  'SUA_NOVA_COLETA_SECRET_AQUI'
);
```

Não precisa recriar o agendamento — ele sempre lê o valor mais recente guardado no Vault.
Lembre de atualizar a mesma senha no secret da Edge Function (passo 4) também, já que as duas
cópias precisam continuar idênticas.

### 8.5 Disparar na hora, sem esperar 30 minutos

```sql
select net.http_post(
  url := 'https://rmggyqqmhupkabgwmnzv.supabase.co/functions/v1/coletar-fontes',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_apikey'),
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_apikey'),
    'x-coleta-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'coleta_fontes_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
);
```

Espere uns 30-40 segundos (a função pode levar esse tempo pra terminar) e confira o resultado:

```sql
select status_code, content, error_msg
from net._http_response
order by created desc
limit 1;
```

### O workflow do GitHub Actions continua existindo, só que agora é manual

O arquivo `.github/workflows/coletar-fontes.yml` não dispara mais sozinho — o gatilho
`schedule` foi removido dele (só ficou o `workflow_dispatch`, o botão de disparo manual).
Continua útil pra testar sem esperar o horário do cron: GitHub → aba **Actions** → workflow
**"Coletar fontes públicas (RJ)"** → **Run workflow**.

## 9. Ver no mapa

Depois que existir pelo menos uma linha em `external_incidents` com `status` `active` ou
`confirmed`, abra a Tela 1 do app (Mapa) — aparece um marcador novo (ícone de megafone, cor
diferente de tudo que já existia) com um checkbox logo abaixo do mapa, **"Mostrar notícias
públicas no mapa"**, pra ligar/desligar essa camada.

## Fontes usadas nesta entrega

| | Feed geral (G1) | Feed de trânsito (G1) | Feed geral (R7) | TempoRealRJ | Fogo Cruzado |
|---|---|---|---|---|---|
| **Nome** | `g1_rio_rss` | `g1_rio_transito_rss` | `r7_rio_rss` | `temporealrj_rss` | `fogo_cruzado` |
| **URL** | `http://g1.globo.com/dynamo/rio-de-janeiro/rss2.xml` | `http://g1.globo.com/dynamo/rio-de-janeiro/transito/rss2.xml` | `https://noticias.r7.com/arc/outboundfeeds/rss/category/rio-de-janeiro/` | `https://temporealrj.com/feed/` | `api-service.fogocruzado.org.br/api/v2` |
| **Tipo** | RSS 2.0, público | RSS 2.0, público | RSS 2.0, público | RSS 2.0, público (WordPress) | API REST, autenticada |
| **O que fornece** | Notícias gerais recentes sobre o Rio de Janeiro (mistura assuntos — a IA que filtra o que é relevante pro app) | Só acidente/interdição/bloqueio de via — já vem filtrado pelo próprio G1, testado ao vivo antes de adicionar | Notícias gerais da editoria Rio de Janeiro do R7 (Record) — mesmo formato do G1, achado no `robots.txt` deles (`/arc/outboundfeeds/`), testado ao vivo | Portal de notícia local independente do Rio (política, Justiça, serviço público, ocorrência) — testado ao vivo, redação própria, não é espelho de outro veículo | Tiroteios/disparos de arma de fogo, com coordenada e data exatas |
| **Precisa de chave?** | Não | Não | Não | Não | Sim (conta cadastrada — ver seção abaixo) |
| **Gratuito?** | Sim | Sim | Sim | Sim | Sim |
| **Limite** | Nenhum limite documentado publicamente — a função processa no máximo 20 itens por execução POR fonte | mesmo limite | mesmo limite | mesmo limite | mesmo limite |
| **Periodicidade** | A cada 30 min (configurável no `cron.schedule` do pg_cron — ver seção 8), todas as fontes juntas | idem | idem | idem | idem |
| **Como configurar** | Nada a configurar — já está pronta pra uso no código | idem | idem | idem | Opcional — secrets `FOGOCRUZADO_EMAIL`/`FOGOCRUZADO_PASSWORD` (ver abaixo) |

> O `robots.txt` do TempoRealRJ pede pra buscador (Google etc.) não indexar `/feed/` — isso é
> configuração comum de SEO em WordPress (evita "conteúdo duplicado" no Google), não uma proibição
> de acesso. Um leitor de RSS de verdade (que é o que esta função é) não é afetado por isso.

**Por que só estas fontes por enquanto:** pesquisei as fontes oficiais citadas no pedido original
(ISP-RJ, Data.Rio, dados abertos do Estado, portal de transparência da Prefeitura) antes de
implementar. Nenhuma delas tinha, no momento da pesquisa, uma API pública de "ocorrências em
tempo real" acessível sem login institucional — o ISP só publica arquivos estatísticos pra
baixar, e a API mais promissora que achei (dados do Centro de Operações Rio) exige autenticação
municipal (Keycloak "Identidade Carioca"). Também tentei achar um RSS do G1 específico pra
polícia/violência/crime — testei vários caminhos prováveis (`policia`, `violencia`, `seguranca`,
`criminalidade`, `furto-e-roubo`) e todos voltam vazios; só o de trânsito funciona de verdade. A
arquitetura deste projeto (`FONTES` dentro de `coletar-fontes/index.ts`) já é feita pra caber
mais uma fonte sem reescrever nada — se você conseguir acesso a alguma dessas APIs no futuro, ou
achar outro feed específico de ocorrência policial, é só escrever outra função `coletar*()` no
mesmo formato e adicionar um item no array `FONTES` (foi exatamente assim que a terceira fonte,
o Fogo Cruzado, abaixo, entrou).

**Uma fonte pedida e testada ao vivo, mas que ficou de fora — com motivo:**
- **"Cidade Alerta"**: é um programa de TV (Record), apresentado ao vivo — não existe site
  próprio nem feed de notícia pra coletar, só transmissão de TV/redes sociais. Não dá pra
  transformar isso numa fonte automática sem um serviço de transcrição de vídeo ao vivo, fora do
  escopo deste projeto.

(A primeira tentativa de achar "Tempo Real Rio" me levou a `alertaurgente.com`, cujo conteúdo é
um espelho do próprio G1 — cada item vinha marcado `"(fonte: G1)"` com link pra `g1.globo.com`,
então não virou fonte. O link certo, `temporealrj.com`, veio depois direto de você — esse sim é
independente, testado e já está na tabela acima.)

## Terceira fonte (opcional): API do Fogo Cruzado (tiroteios)

**O que é**: Instituto Fogo Cruzado (ONG, CNPJ 41.138.166/0001-5) — mapeia tiroteios e disparos
de arma de fogo no Rio de Janeiro desde julho de 2016, com checagem humana por uma equipe de
analistas antes de publicar (não é post cru de rede social). É um tipo de dado bem mais próximo
de "assalto"/violência armada do que o RSS de notícias gerais do G1, e cada ocorrência já vem
com coordenada exata, data exata e bairro estruturado — testei ao vivo contra a API real e
confirmei o formato de resposta (não é integração especulativa).

**Diferente das outras duas fontes, esta é opcional** porque exige uma conta cadastrada na API
deles (não tem cadastro público automático — se precisar pedir de novo no futuro, o canal é
e-mail pra `contato@fogocruzado.org.br`). Sem os secrets abaixo configurados, esta fonte
simplesmente fica indisponível a cada execução (aparece como erro só dela no resumo da coleta),
sem afetar as outras duas.

### Como ativar

No Dashboard do Supabase → **Edge Functions** → **coletar-fontes** → **Secrets**, adicione:

- Nome: `FOGOCRUZADO_EMAIL` — valor: o e-mail da conta cadastrada na API do Fogo Cruzado
- Nome: `FOGOCRUZADO_PASSWORD` — valor: a senha dessa conta

Depois publique a função de novo (colar o arquivo inteiro no editor do Dashboard, mesmo processo
de sempre) — o código já faz login, busca o `id` do estado "Rio de Janeiro" dinamicamente (nunca
fixo no código) e traz as ocorrências dos últimos 2 dias a cada execução.

### Como funciona por baixo

- **Login**: `POST https://api-service.fogocruzado.org.br/api/v2/auth/login` com
  `{ "email", "password" }` → devolve um `accessToken` válido por 1h (a coleta é bem mais rápida
  que isso, então não precisa renovar).
- **Estados**: `GET .../api/v2/states` — usado só pra achar o `id` de "Rio de Janeiro" pelo nome
  (o mesmo princípio de `cidadeEhDoRJ` deste projeto: nunca fixar um UUID chutado no código).
- **Ocorrências**: `GET .../api/v2/occurrences?idState=...&initialdate=...&finaldate=...` — cada
  item já traz `city.name`, `neighborhood.name`, `latitude`/`longitude`, `date` (ISO 8601) e o
  motivo da ocorrência (`contextInfo.mainReason.name`, ex.: "Operação policial").
- Como os dados já vêm exatos, o item pulа a geocodificação por bairro (Photon) e o "adivinhar
  data" — usa a coordenada e a data que a própria fonte confirmou (`coordenadaConhecida`/
  `ocorridoEmConhecido` em `processarItem`), o que tende a dar confiança mais alta que uma
  notícia de RSS solta.
- Classificado com a categoria própria `tiroteio` (ver `PROMPT_SISTEMA` em
  `coletar-fontes/index.ts`) — antes virava `assalto` por falta dessa categoria, o que misturava
  risco de assalto com risco de violência armada no mesmo selo; agora os dois aparecem
  separados no mapa.

## Geocodificação também tenta rua/rodovia, não só bairro

Notícia de trânsito raramente cita um bairro ("BR-393", "Via Dutra na altura de Piraí" não são
bairro) — antes disso, esses itens nunca conseguiam coordenada e ficavam permanentemente sem
pino no mapa. A IA agora também extrai `locationText` (rua/avenida/rodovia/ponto de referência
citado no texto, só quando está escrito de verdade — nunca inventado) e a Edge Function tenta
geocodificar isso quando não há bairro. Ainda assim, sem NENHUM lugar específico no texto (só o
nome da cidade), o item continua sem pino — o princípio de "nunca inventar localização" não
mudou, só ficou menos exigente sobre que tipo de lugar conta como específico o bastante.

## Custos e limites

| Serviço | Gratuito? | Precisa cartão? | Limite |
|---|---|---|---|
| RSS do G1 | Sim | Não | Nenhum documentado |
| Google Gemini (`gemini-3.5-flash-lite`) | Sim, nível gratuito real | Não, pra começar | Varia por conta — confira a sua no AI Studio (ver `README_AI_SETUP.md`) |
| Photon (geocodificação do bairro) | Sim, mesmo serviço já usado no resto do site | Não | Uso moderado (no máx. 20 consultas por execução da coleta) |
| GitHub Actions | Sim, em repositório público | Não | 2.000 minutos/mês grátis em conta gratuita — esta tarefa usa poucos segundos por execução, bem longe do limite |
| Supabase (banco/Edge Function) | Já está configurado no plano que você já usa no resto do projeto | — | Mesmo limite que o resto do app já respeita |

Nada aqui foi inventado — o que não pude confirmar com um número exato (o limite diário do
Gemini) está marcado como "confira o seu", em vez de eu chutar um valor.

## O que fica pendente pra você validar

- A chamada real ao Gemini — só funciona com a SUA chave, não dá pra eu testar isso sem ela.
- O agendamento real do pg_cron — só existe depois que você rodar o SQL da seção 8 no seu projeto.
- A qualidade da classificação no dia a dia — vale acompanhar os **Logs** (passo 7) nos primeiros
  dias e ajustar os pesos da fórmula de confiança (topo de `coletar-fontes/index.ts`) se achar
  que algo está ficando com confiança alta ou baixa demais.
