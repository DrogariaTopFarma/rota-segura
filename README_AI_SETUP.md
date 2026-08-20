# Configurar a IA (Google Gemini) — Rota Segura

Este documento explica como configurar a IA usada pela coleta de fontes públicas
(`supabase/functions/coletar-fontes`). Se você só quer ativar a feature inteira do zero (banco,
Edge Function, agendamento), comece por `COMO_CONFIGURAR_COLETA_RJ.md` — ele te manda pra cá na
hora certa.

## Por que Google Gemini

Pesquisei as opções antes de escolher. Os dois critérios que mais pesaram: **não pedir cartão de
crédito pra começar** (mesma regra que já usamos pra escolher o OpenRouteService no Bloco 2 — este
projeto evita serviços que exigem cartão) e **suportar resposta em JSON estruturado de verdade**
(a IA é obrigada a devolver exatamente os campos pedidos, nunca texto solto que a gente teria que
tentar interpretar na mão — isso é o que impede a IA de "inventar" um campo fora do formato).

- **Site**: <https://aistudio.google.com/>
- **Modelo usado**: `gemini-2.5-flash-lite`
- **Nível gratuito**: existe, sem cartão de crédito pra começar. O Google não publica um número
  fixo de requisições por dia em documentação pública — o limite exato da SUA chave aparece no
  próprio AI Studio (veja o passo 5 abaixo). Por isso não afirmo aqui um número exato de
  requisições — confira o seu.
- **Documentação oficial**: <https://ai.google.dev/gemini-api/docs>

Se um dia você quiser trocar de IA (ex.: por já ter conta em outro serviço), só precisa reescrever
a função `classificarComIA` dentro de `supabase/functions/coletar-fontes/index.ts` — o resto do
arquivo (filtro geográfico, deduplicação, pontuação de confiança) não depende de qual IA você usa.

## Passo a passo

### 1. Criar a conta

1. Acesse <https://aistudio.google.com/> e entre com uma conta Google (a mesma do Gmail, se você
   já tiver uma).
2. Aceite os termos de uso do Google AI Studio, se pedido.

### 2. Criar a API key

1. No menu do AI Studio, procure por **"Get API key"** (geralmente no canto superior esquerdo).
2. Clique em **"Create API key"**.
3. Escolha (ou crie) um projeto do Google Cloud pra associar a chave — pode aceitar o padrão
   sugerido, não precisa configurar nada a mais nele.
4. A chave aparece na tela, algo como `AIzaSy...`. Copie e guarde num lugar seguro por enquanto
   (um bloco de notas local, por exemplo — nunca num arquivo que vá pro GitHub).

### 3. Onde a chave NUNCA deve ir

- ❌ `js/config.js` — esse arquivo é público, qualquer pessoa que abrir o site vê o conteúdo dele.
- ❌ Qualquer arquivo `.html`, `.js` ou `.md` deste repositório.
- ❌ Direto no código da Edge Function (`supabase/functions/coletar-fontes/index.ts`).
- ✅ **Só** como *secret* da Edge Function, configurado pelo painel do Supabase (próximo passo).

### 4. Configurar a chave no Supabase

1. Publique a Edge Function `coletar-fontes` primeiro, se ainda não publicou (passo a passo em
   `COMO_CONFIGURAR_COLETA_RJ.md`).
2. No painel do Supabase, vá em **Edge Functions** → clique em **coletar-fontes** → aba
   **Secrets** (ou **Settings**, dependendo da versão do painel).
3. Adicione um novo secret:
   - Nome: `GEMINI_API_KEY`
   - Valor: a chave que você copiou no passo 2 (`AIzaSy...`)
4. Salve.

### 5. Conferir o limite gratuito da sua conta

1. Volte ao AI Studio → **"Get API key"** → deve haver um link/aba mostrando o uso e os limites
   (*rate limits*) da sua chave.
2. Anote o número de requisições por dia disponível — isso ajuda a decidir o intervalo do
   agendamento em `.github/workflows/coletar-fontes.yml` (quanto menor o intervalo, mais chamadas
   de IA por dia).

### 6. Testar

Depois de configurar o secret, dispare a Edge Function manualmente (veja "Como testar" em
`COMO_CONFIGURAR_COLETA_RJ.md`). Se a chave estiver certa, a resposta traz um resumo de quantas
notícias foram encontradas/processadas. Se vier um erro mencionando `GEMINI_API_KEY`, confira se o
nome do secret está exatamente assim (maiúsculas, sem espaço) e se você publicou a função DEPOIS
de adicionar o secret.

### 7. Ver os logs

Painel do Supabase → **Edge Functions** → **coletar-fontes** → aba **Logs**. Cada execução
imprime, por notícia processada, se ela foi aceita, rejeitada (fora do RJ, estatística, etc.) ou
deu erro — é ali que você confirma se a coleta está funcionando de verdade, não só "sem erro".

### 8. Trocar de modelo

O modelo está numa única constante, no topo da função `classificarComIA` em
`supabase/functions/coletar-fontes/index.ts`:

```js
const modelo = 'gemini-2.5-flash-lite';
```

Troque por outro nome de modelo do Gemini (ex.: `gemini-2.5-flash`, mais capaz porém com limite
gratuito menor) se precisar de mais qualidade de classificação e não se importar com um limite
diário menor. Depois de editar, publique a função de novo (colar o arquivo inteiro no Dashboard).

## Custos e limites (o que confirmei, nada inventado)

| Item | O que sei |
|---|---|
| Cartão de crédito pra começar | Não precisa — nível gratuito ativa só com a conta Google. |
| Limite exato de requisições/dia | Varia por conta e o Google não publica um número fixo em documentação pública — confira o seu no AI Studio (passo 5). |
| O que acontece se estourar o limite | A chamada falha com erro 429 — a função já tenta de novo com espera crescente (até 3 tentativas) e, se continuar falhando, pula aquela notícia e segue pras próximas, sem derrubar a coleta inteira. |
| Cobrança | Só existe se você **ativar faturamento** manualmente no projeto do Google Cloud associado — isso não acontece sozinho. Enquanto não ativar, a chave só funciona dentro do nível gratuito. |
