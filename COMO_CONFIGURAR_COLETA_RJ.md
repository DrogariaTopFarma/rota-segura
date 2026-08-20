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
5. O agendamento automático, via GitHub Actions.
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
  "fontes": { "g1_rio_rss": { "encontrados": 20, "processados": 3 } },
  "erros": []
}
```

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
| `processados` sempre 0 | Normal nas primeiras vezes (poucas notícias do RJ no feed no momento), ou a IA está marcando tudo como fora do RJ/estatística | Veja os **Logs** da função (próximo item) pra saber o motivo exato de cada notícia descartada |
| Erro de rede/timeout | RSS do G1 ou a API do Gemini estavam fora do ar na hora | Tente de novo — a função não derruba nada, só aquela execução específica falha |

## 7. Ver os logs

Painel do Supabase → **Edge Functions** → **coletar-fontes** → aba **Logs**. Cada execução
imprime o que aconteceu com cada notícia (aceita, rejeitada e por quê, erro específico) — é ali
que você confirma o funcionamento de verdade, não só "sem erro na tela".

## 8. Agendar (GitHub Actions)

O arquivo `.github/workflows/coletar-fontes.yml` já existe neste projeto — só falta configurar
3 segredos do **repositório no GitHub** (diferente dos secrets da Edge Function, que já
configurou antes):

1. No GitHub, abra o repositório → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**.
2. Adicione:
   - Nome: `SUPABASE_FUNCTION_URL` — valor: `https://SEU-PROJETO.supabase.co/functions/v1/coletar-fontes`
   - Nome: `COLETA_SECRET` — valor: a MESMA senha do passo 4 (tem que ser idêntica à da Edge
     Function, senão a chamada é recusada)
   - Nome: `SUPABASE_SECRET_API_KEY` — valor: a chave **secreta** do seu projeto (Project
     Settings → **API Keys**, o valor que começa com `sb_secret_...`, diferente da
     `sb_publishable_...` que está em `js/config.js`). O "portão de entrada" das Edge Functions
     deste projeto exige essa chave pra deixar a chamada passar, antes mesmo dela chegar na
     função — é uma exigência da infraestrutura do Supabase, separada da nossa própria
     `COLETA_SECRET`, que continua sendo quem autoriza a coleta de verdade.
     > ⚠️ Essa chave é sensível de verdade (equivale à antiga `service_role`, ignora o RLS).
     > Só pode ficar como secret do GitHub — nunca em nenhum arquivo deste repositório.
3. Pronto — o GitHub já vai chamar a função sozinho a cada 30 minutos (horário configurável no
   próprio arquivo `.yml`, comentado nele).

### Como testar se deu certo

1. No GitHub, vá na aba **Actions** do repositório.
2. Clique no workflow **"Coletar fontes públicas (RJ)"** na lista à esquerda.
3. Botão **"Run workflow"** → **"Run workflow"** de novo, pra disparar manualmente sem esperar o
   horário agendado.
4. Espere terminar (alguns segundos) e clique na execução pra ver o resultado — deve terminar
   verde (sucesso). Se falhar, o log do próprio GitHub Actions mostra o código HTTP e a resposta
   da função, que ajuda a identificar o motivo (mesma tabela de erros da seção 6).

> O GitHub Actions só roda de verdade depois que o repositório está publicado no GitHub — não dá
> pra testar isso especificamente rodando o projeto local no seu computador.

## 9. Ver no mapa

Depois que existir pelo menos uma linha em `external_incidents` com `status` `active` ou
`confirmed`, abra a Tela 1 do app (Mapa) — aparece um marcador novo (ícone de megafone, cor
diferente de tudo que já existia) com um checkbox logo abaixo do mapa, **"Mostrar notícias
públicas no mapa"**, pra ligar/desligar essa camada.

## Fonte usada nesta entrega

| | |
|---|---|
| **Nome** | RSS do G1 Rio de Janeiro |
| **URL** | `http://g1.globo.com/dynamo/rio-de-janeiro/rss2.xml` |
| **Tipo** | RSS 2.0, público |
| **Precisa de chave?** | Não |
| **Gratuito?** | Sim |
| **Limite** | Nenhum limite documentado publicamente — a função já processa no máximo 20 itens por execução, então o uso é sempre moderado |
| **Periodicidade** | A cada 30 min (configurável em `.github/workflows/coletar-fontes.yml`) |
| **O que fornece** | Título, resumo e data de notícias recentes sobre o Rio de Janeiro |
| **Como configurar** | Nada a configurar — já está pronta pra uso no código |

**Por que só esta fonte por enquanto:** pesquisei as fontes oficiais citadas no pedido original
(ISP-RJ, Data.Rio, dados abertos do Estado, portal de transparência da Prefeitura) antes de
implementar. Nenhuma delas tinha, no momento da pesquisa, uma API pública de "ocorrências em
tempo real" acessível sem login institucional — o ISP só publica arquivos estatísticos pra
baixar, e a API mais promissora que achei (dados do Centro de Operações Rio) exige autenticação
municipal (Keycloak "Identidade Carioca"). A arquitetura deste projeto (`FONTES` dentro de
`coletar-fontes/index.ts`) já é feita pra caber mais uma fonte sem reescrever nada — se você
conseguir acesso a alguma dessas APIs no futuro, é só escrever outra função `coletar*()` no mesmo
formato e adicionar um item no array `FONTES`.

## Custos e limites

| Serviço | Gratuito? | Precisa cartão? | Limite |
|---|---|---|---|
| RSS do G1 | Sim | Não | Nenhum documentado |
| Google Gemini (`gemini-2.5-flash-lite`) | Sim, nível gratuito real | Não, pra começar | Varia por conta — confira a sua no AI Studio (ver `README_AI_SETUP.md`) |
| Photon (geocodificação do bairro) | Sim, mesmo serviço já usado no resto do site | Não | Uso moderado (no máx. 20 consultas por execução da coleta) |
| GitHub Actions | Sim, em repositório público | Não | 2.000 minutos/mês grátis em conta gratuita — esta tarefa usa poucos segundos por execução, bem longe do limite |
| Supabase (banco/Edge Function) | Já está configurado no plano que você já usa no resto do projeto | — | Mesmo limite que o resto do app já respeita |

Nada aqui foi inventado — o que não pude confirmar com um número exato (o limite diário do
Gemini) está marcado como "confira o seu", em vez de eu chutar um valor.

## O que fica pendente pra você validar

- A chamada real ao Gemini — só funciona com a SUA chave, não dá pra eu testar isso sem ela.
- O disparo real do GitHub Actions — só roda depois do repositório publicado.
- A qualidade da classificação no dia a dia — vale acompanhar os **Logs** (passo 7) nos primeiros
  dias e ajustar os pesos da fórmula de confiança (topo de `coletar-fontes/index.ts`) se achar
  que algo está ficando com confiança alta ou baixa demais.
