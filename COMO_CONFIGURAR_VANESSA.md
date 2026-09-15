# Como configurar a Vanessa (chat de IA da Comunidade)

Passo a passo pra ligar de vez a "Vanessa" — o chat de IA que aparece na Tela 3 (Comunidade),
que responde só dois assuntos: segurança pessoal/nas ruas, e como usar o Rota Segura.

Reaproveita a mesma IA (Google Gemini, nível gratuito, sem cartão) já usada na coleta de
notícias — se você já configurou o `GEMINI_API_KEY` pra `coletar-fontes`, é a mesma chave, só
precisa colar de novo aqui (Edge Function não compartilha secret entre funções).

## O que já está pronto no código (nada a fazer aqui)

- `supabase/functions/perguntar-vanessa/index.ts` — a função que conversa com o Gemini.
- `js/vanessa.js` — abre/fecha o chat, manda a pergunta, mostra a conversa.
- `pages/alertas.html` — o botão flutuante e o modal do chat, já na Tela 3.
- `css/comunidade.css` — o visual do chat (bolhas de mensagem, perguntas frequentes).

## O que só você consegue fazer

### 1. Publicar a Edge Function

Dashboard do Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** → nome:
`perguntar-vanessa` → cola o arquivo `supabase/functions/perguntar-vanessa/index.ts` inteiro →
Deploy.

### 2. Configurar o secret desta função

Dashboard → Edge Functions → `perguntar-vanessa` → **Secrets** → adicione:

- Nome: `GEMINI_API_KEY` — valor: a mesma chave `AIzaSy...` que você já usa em `coletar-fontes`
  (se ainda não tem uma, o passo a passo de criar está em `README_AI_SETUP.md`, seção "Criar a
  API key").

Diferente das outras funções deste projeto, **não precisa criar nenhum secret de senha própria**
nem configurar Database Webhook ou agendamento — a Vanessa é chamada direto pelo site quando
alguém toca no botão do chat, com a própria usuária já logada (o Supabase confere isso sozinho).

### 3. Testar

1. Publique a função e configure o secret acima.
2. Abra o site, entre com uma conta, vá pra Comunidade (Tela 3).
3. Toque no botão redondo rosa (ícone de balão de conversa) no canto inferior direito.
4. Toque numa das perguntas frequentes, ou digite a sua.
5. Se a chave estiver certa, a resposta da Vanessa aparece em alguns segundos. Se vier uma
   mensagem de erro genérica, confira em Dashboard → Edge Functions → `perguntar-vanessa` →
   **Logs** — lá aparece o motivo de verdade (secret faltando, chave recusada pelo Google, etc.).

## Limites (o que já vale saber)

- A conversa vive só na aba aberta — recarregar a página começa uma conversa nova. Não é uma
  omissão, foi decisão deliberada pra não precisar guardar conversa de chat no banco agora.
- O nível gratuito do Gemini tem limite de uso — se muita gente conversar com a Vanessa ao mesmo
  tempo, ela pode responder "recebeu muitas perguntas agora" por um tempinho. Isso é esperado
  dentro do nível gratuito, não é erro de configuração.
- A Vanessa é uma camada de apoio (tira dúvida, dá dica) — nunca um substituto de ligar pra 190
  numa emergência real. Isso já está reforçado tanto no aviso fixo do chat quanto no prompt dela.
