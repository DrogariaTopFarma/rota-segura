# Rota Segura

Rede colaborativa de segurança e apoio para mulheres: mapa de relatos com nível de segurança e densidade visual, delegacias (DEAM) e pontos de apoio no mapa, geocodificação automática de endereço, mural de avisos em tempo real, validação comunitária de relatos, barra SOS com ligação de 1 clique, filtro por horário, guia de segurança e login com banco de dados real (Supabase).

## Novidades desta versão

- **Geocodificação automática**: ao digitar rua/número/bairro no cadastro de relato (ou o endereço de uma instituição), um mini mapa localiza o ponto sozinho — a usuária só confirma. Também dá para arrastar o pino ou clicar no mapa para ajustar manualmente.
- **Densidade visual no mapa**: quanto mais relatos um mesmo local recebe, maior o pino fica. Clicar no pino abre todos os relatos daquele ponto.
- **Delegacias (DEAM) e Pontos de Apoio**: cadastráveis pelo app, aparecem no mapa com ícones exclusivos (rosa para delegacia, verde para ponto de apoio) e têm um filtro de camadas próprio.
- **Mural de Avisos**: feed em tempo real com "há X min/h/dias", separado do fórum antigo — pense nele como um "Twitter local de segurança".
- **Validação comunitária**: cada relato tem botões "Concordo" / "Não concordo"; os mais confirmados aparecem no topo da lista de detalhes.
- **Anônimo**: checkbox no cadastro de relato e no mural — o nome não aparece para as outras usuárias (mas o registro continua vinculado à conta internamente, para moderação/edição).
- **Filtro por período**: Manhã / Tarde / Noite / Madrugada, baseado no horário informado pela autora do relato (não no horário da postagem).
- **Barra SOS**: um botão fixo abre um menu com WhatsApp de emergência + ligação de 1 toque para 180 (Central da Mulher), 190 (Polícia) e 192 (SAMU).
- **Guia de Segurança**: aba com dicas de prevenção na rua, transporte público e orientações jurídicas básicas (Lei Maria da Penha, medidas protetivas).

Se você já tinha rodado a versão anterior do banco, rode **`sql/migration_v2.sql`** (não `schema.sql`) para não perder dados existentes — veja o Passo 2 abaixo.

## Estrutura de pastas

```
rota-segura/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── config.js          → suas chaves do Supabase (você preenche)
│   ├── supabaseClient.js  → inicializa o cliente Supabase
│   ├── auth.js             → cadastro, login, logout, perfil
│   ├── database.js         → CRUD de locais + lógica "mais recente"
│   ├── map.js               → mapa Leaflet, marcadores, escolha de ponto
│   ├── community.js        → fórum/chat em tempo real
│   ├── emergency.js        → geolocalização + link do WhatsApp
│   └── app.js               → liga tudo à interface
└── sql/
    └── schema.sql          → script para criar as tabelas no Supabase
```

---

## Passo 1 — Criar o projeto no Supabase (gratuito)

1. Acesse **supabase.com** e crie uma conta (dá para usar o GitHub).
2. Clique em **New project**.
3. Escolha um nome (ex: `rota-segura`), uma senha forte para o banco (guarde-a) e a região mais próxima (ex: São Paulo/`sa-east-1`).
4. Aguarde ~2 minutos até o projeto ficar pronto.

## Passo 2 — Rodar o schema do banco

**Banco novo (primeira vez):**
1. No painel do projeto, abra **SQL Editor** → **New query**.
2. Copie todo o conteúdo de `sql/schema.sql` deste projeto e cole no editor.
3. Clique em **Run**. Isso cria as tabelas `perfis`, `locais`, `comunidade_posts`, `instituicoes`, `locais_votos`, ativa o **RLS** (Row Level Security) e liga o **Realtime**.
4. Confira em **Table Editor** se as cinco tabelas aparecem.

**Já tinha rodado uma versão anterior?**
Rode `sql/migration_v2.sql` em vez do `schema.sql` — ele só adiciona as colunas e tabelas novas, sem apagar nada do que já existe.

**Quer colocar delegacias (DEAM) reais no mapa?**
No fim do `schema.sql` há um exemplo comentado de `insert into instituicoes`. Pegue o endereço e telefone reais da DEAM da sua região e as coordenadas (Google Maps → botão direito no ponto exato → copiar coordenadas), e rode o `insert` no SQL Editor.

## Passo 3 — Pegar as chaves de API

1. No menu lateral, vá em **Project Settings → API**.
2. Copie:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public key** (uma chave longa)
3. Abra `js/config.js` no VS Code e substitua:

```js
export const SUPABASE_URL = "https://xxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "sua-anon-public-key-aqui";
```

> ⚠️ Use sempre a **anon public key**, nunca a `service_role key` (essa é secreta e não deve entrar no front-end).

## Passo 4 — Ativar autenticação por e-mail/senha

1. No painel, vá em **Authentication → Providers**.
2. Confirme que **Email** está habilitado.
3. Para testar rápido na feira, em **Authentication → Settings**, você pode **desativar** "Confirm email" (assim a conta já entra logada, sem precisar clicar em link de e-mail). Em produção, o ideal é manter a confirmação ativada.

## Passo 5 — Testar localmente no VS Code

Arquivos HTML com `<script type="module">` **precisam** ser servidos por um servidor local (não funcionam abrindo o arquivo direto com `file://`).

1. Instale a extensão **Live Server** no VS Code.
2. Clique com o botão direito em `index.html` → **Open with Live Server**.
3. O navegador abre em algo como `http://127.0.0.1:5500`.
4. Crie uma conta pela tela de cadastro e teste: cadastrar local, ver no mapa, publicar na comunidade e clicar no botão de emergência (o navegador vai pedir permissão de localização).

## Passo 6 — Subir para o GitHub

```bash
cd rota-segura
git init
git add .
git commit -m "Rota Segura: reformulação com Supabase, mapa, comunidade e emergência"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/rota-segura.git
git push -u origin main
```

> Como a `anon key` é pública por natureza (protegida pelas políticas de RLS), não há problema em versionar `config.js`. Se preferir mais cuidado, adicione `js/config.js` ao `.gitignore` e crie um `config.example.js` para orientar quem for clonar o projeto.

## Passo 7 — Publicar (GitHub Pages ou Render)

**Opção A — GitHub Pages (mais simples, é um site estático):**
1. No repositório do GitHub, vá em **Settings → Pages**.
2. Em "Source", selecione a branch `main` e a pasta `/root`.
3. Salve e aguarde o link (algo como `https://seu-usuario.github.io/rota-segura`).

**Opção B — Render (Static Site):**
1. Em render.com, **New → Static Site**.
2. Conecte o repositório do GitHub.
3. Build command: deixe em branco. Publish directory: `.` (raiz do projeto).
4. Deploy.

Depois de publicar, volte no Supabase em **Authentication → URL Configuration** e adicione a URL do site publicado em **Site URL** / **Redirect URLs**.

---

## Solução de problemas

**Antes de mais nada: confirme que está testando a versão atual do código.**
1. Apague **toda** a pasta antiga do projeto no seu computador e extraia o zip novo do zero (não copie arquivo por arquivo por cima — isso é a causa mais comum de "corrigi mas continua igual").
2. Abra o site, aperte **F12** (DevTools) → aba **Console**.
3. Você deve ver a mensagem `[Rota Segura] app.js versão 3 carregado`. Se não aparecer, ou aparecer uma versão antiga, o navegador está te mostrando um arquivo em cache: feche a aba, abra uma **aba anônima** e teste de novo, ou aperte **Ctrl+Shift+R** (recarregar ignorando cache).
4. Se estiver usando o Live Server do VS Code, pare e reinicie a extensão depois de trocar os arquivos — às vezes ela mantém a aba antiga aberta.

**Os modais ("Cadastrar local", "Meu perfil") aparecem abertos sozinhos, sem eu clicar em nada, logo depois de criar a conta ou fazer login.**
Causa raiz encontrada e corrigida: os modais só eram fechados quando você clicava no X ou fora deles — mas nunca eram resetados nas trocas de tela (login, logout, cadastro). Se em algum momento da mesma aba os dois modais chegaram a abrir, eles continuavam com `hidden = false` guardado, e voltavam a aparecer por cima quando o app trocava a tela de fundo (login → app), mesmo sem você reabri-los. Agora toda troca de tela (entrar no app, sair, voltar pro login) força o fechamento de qualquer modal. Confirme que está na versão 3 (veja o passo acima) — essa correção só existe a partir dela.

**Apaguei o usuário no Supabase, mas o app continua entrando direto na tela principal em vez de mostrar o login.**
Isso acontece porque o token de login fica salvo no navegador e continua "parecendo válido" até expirar sozinho, mesmo depois de a conta ser apagada no painel. Já corrigido: agora, ao abrir o app, ele confirma a sessão direto no servidor (não só confia no que está salvo localmente) e desloga automaticamente se a conta não existir mais. Se você já baixou uma versão anterior, um `Ctrl+Shift+R` (recarregar sem cache) ou limpar os dados do site resolve manualmente.

**Abri "Meu perfil" e está tudo com "—" (traço), ou os campos de perfil aparecem vazios.**
Isso acontece quando a linha correspondente na tabela `perfis` nunca foi criada — geralmente porque a conta foi cadastrada com uma versão do `auth.js` anterior a esta, ou porque a confirmação de e-mail estava ativada e o app não conseguiu recriar o perfil no primeiro login. Se isso acontecer com uma conta de teste:
1. No Supabase, vá em **Authentication → Users**, apague o usuário de teste.
2. Cadastre-se novamente pela tela de "Criar conta" — com a versão atual do `auth.js`, o contato de emergência fica salvo tanto em `perfis` quanto no `user_metadata`, então o perfil se recria sozinho mesmo se o primeiro login acontecer antes da confirmação por e-mail.

**Os modais de "Cadastrar local" e "Meu perfil" abriram um em cima do outro.**
Já corrigido: agora abrir qualquer modal fecha automaticamente os demais, e a tecla **Esc** fecha o modal aberto.

## Observações do desenvolvedor — rodada de funcionalidades novas

1. **Geocodificação usa o Nominatim (OpenStreetMap), que é gratuito mas tem uso justo**: no máximo ~1 requisição por segundo. O `geocode.js` já tem debounce de 800ms enquanto a usuária digita, e cancela buscas antigas ainda em andamento — isso é suficiente para uso normal do app, mas não tente geocodificar em massa (ex: um script que geocodifica 500 endereços de uma vez) a partir do navegador.
2. **"Confirmar localização" é uma trava intencional**: o formulário só permite salvar depois desse clique, mesmo que a geocodificação já tenha posicionado o pino sozinha. Isso evita salvar coordenadas erradas por engano quando o endereço tem nomes parecidos em bairros diferentes.
3. **Delegacias e pontos de apoio são cadastráveis por qualquer usuária autenticada.** Isso é de propósito (colaborativo, como o resto do app), mas em produção real vale considerar um passo de moderação/aprovação antes de um pino "oficial" de delegacia aparecer para todo mundo — hoje ele aparece imediatamente.
4. **Anônimo esconde o nome só na interface.** `autor_id` continua salvo no banco (é o que permite RLS de edição/exclusão e evita spam). Se a proposta evoluir para anonimato mais forte, seria necessário repensar esse modelo — hoje, alguém com acesso direto ao banco (não à interface) ainda vê quem postou.
5. **O filtro de período é auto-declarado.** A usuária escolhe manualmente em que período o fato ocorreu; não é calculado a partir da hora da postagem, porque muita gente relata horas ou dias depois do ocorrido.
6. **Validação comunitária ("Concordo/Não concordo") não bloqueia nem remove relatos automaticamente** — ela só reordena, priorizando os mais confirmados. Adicionar um limite (ex: ocultar relato com muitos "não concordo") é uma extensão natural, mas decidi não esconder relatos automaticamente para não criar um mecanismo fácil de silenciar denúncias reais por brigada de votos.
7. **Os botões SOS de 180/190/192 usam `tel:` puro** — funcionam nativamente em celular (abrem o discador). Em desktop sem app de telefone associado, o navegador pode não fazer nada visível; isso é esperado e não é um bug do app.

## Observações do desenvolvedor (leia antes de usar em produção)

Pontos que ajustei ou que merecem atenção, pensando em um app real de segurança:

1. **RLS em todas as tabelas.** Por padrão, uma tabela nova no Supabase fica *aberta* até você ativar o RLS — deixei isso ativado desde o `schema.sql`, com políticas que restringem cada ação (ex: só a autora edita seu próprio local).
2. **Contato de emergência é dado sensível.** A tabela `perfis` só permite que a própria usuária leia seus dados (`auth.uid() = id`). Ele nunca é público para as outras usuárias.
3. **A localização de emergência não é salva no banco.** `emergency.js` lê a geolocalização do navegador só na hora do clique e monta o link do WhatsApp — nada fica gravado no Supabase. Isso evita criar um histórico de localização que, se vazado, viraria um risco justamente para quem o app deveria proteger.
4. **Senhas não passam pelo seu código.** O Supabase Auth cuida do hash e do armazenamento da senha; seu front-end só chama `signUp`/`signInWithPassword`.
5. **Escape de HTML.** Todo conteúdo digitado por usuárias (nome de local, descrição, mensagens da comunidade) é inserido via `textContent`/escape antes de virar HTML, para evitar XSS.
6. **Lógica de "mais recente".** Cada local recebe uma `local_key` (nome + bairro normalizados). Ao listar, o app mantém só o cadastro mais novo de cada chave e guarda os demais como `desatualizados` — hoje eles ficam ocultos, mas dá para exibi-los com um selo "informação antiga" se quiser manter o histórico visível.
7. **Pontos de melhoria para depois da feira:**
   - Moderação de conteúdo na comunidade (hoje qualquer texto é aceito).
   - Edição de perfil pela interface (hoje é só leitura no modal; dá pra adicionar um formulário de update).
   - Opção de post anônimo na comunidade, para relatos sensíveis.
   - Upload de fotos dos locais (dá pra usar o **Supabase Storage**, que também é gratuito).
   - Um "modo pânico" que também dispare um SMS, já que depender só do WhatsApp exige internet.
