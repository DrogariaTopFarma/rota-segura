# Guia passo a passo — Rota Segura (Blocos 1 e 2)

Este guia parte do zero. Não presume que você já usou terminal, Supabase, GitHub ou VS Code.
Faça uma etapa por vez e só avance depois do teste de cada uma dar certo.

> **Aviso sobre nomes de botões:** o Supabase e o GitHub mudam a interface de tempos em tempos.
> Se um botão estiver com nome ligeiramente diferente, procure pela palavra-chave que eu citar
> (ex.: "API", "SQL Editor", "Pages"). O caminho é o mesmo.

---

## Índice

- [Etapa 0 — Preparar o computador](#etapa-0--preparar-o-computador)
- [Etapa 1 — Criar conta e projeto no Supabase](#etapa-1--criar-conta-e-projeto-no-supabase)
- [Etapa 2 — Rodar o SQL (criar o banco)](#etapa-2--rodar-o-sql-criar-o-banco)
- [Etapa 3 — Pegar a URL e a chave anon](#etapa-3--pegar-a-url-e-a-chave-anon)
- [Etapa 4 — Configurar a autenticação](#etapa-4--configurar-a-autenticação)
- [Etapa 5 — Colocar os arquivos no computador e configurar](#etapa-5--colocar-os-arquivos-no-computador-e-configurar)
- [Etapa 6 — Rodar o projeto localmente](#etapa-6--rodar-o-projeto-localmente)
- [Etapa 7 — Testar tudo (checklist)](#etapa-7--testar-tudo-checklist)
- [Etapa 8 — Publicar no GitHub Pages](#etapa-8--publicar-no-github-pages)
- [Etapa 9 — Ajustar o Supabase para o site publicado](#etapa-9--ajustar-o-supabase-para-o-site-publicado)
- [Etapa 10 — Localização: erro do aparelho x limite do serviço](#etapa-10--localização-entendendo-o-que-é-erro-e-o-que-é-limite-do-serviço)
- [Etapa 11 — Bloco 2: criar a conta e a chave no OpenRouteService](#etapa-11--bloco-2-criar-a-conta-e-a-chave-no-openrouteservice)
- [Etapa 12 — Bloco 2: publicar a Edge Function no Supabase](#etapa-12--bloco-2-publicar-a-edge-function-no-supabase)
- [Etapa 13 — Bloco 2: testar rotas e navegação ativa](#etapa-13--bloco-2-testar-rotas-e-navegação-ativa)
- [Sobre o .env (leia antes de procurar por ele)](#sobre-o-env-leia-antes-de-procurar-por-ele)
- [Dicionário rápido](#dicionário-rápido)

---

## Etapa 0 — Preparar o computador

### O que fazer, clique por clique

**0.1 — Instalar o VS Code (editor de código)**

1. Abra seu navegador e vá em `https://code.visualstudio.com`.
2. O site detecta seu sistema sozinho. Clique no botão azul grande escrito **Download for Windows**
   (ou **Download for Mac**).
3. Abra o arquivo baixado (fica na pasta **Downloads**).
   - **Windows:** o arquivo termina em `.exe`. Marque a caixinha
     **"Add to PATH"** e também **"Add 'Open with Code' action to Windows Explorer file context menu"**.
     Clique em **Next** até o fim e depois em **Install**.
   - **Mac:** o arquivo é um `.zip`. Descompacte com dois cliques e **arraste** o ícone
     "Visual Studio Code" para dentro da pasta **Aplicativos**.
4. Abra o VS Code.

**0.2 — Instalar a extensão Live Server**

O navegador não deixa arquivos abertos com dois cliques (`file:///`) usarem módulos JavaScript.
Sem um servidor local, o app não funciona. O Live Server resolve isso com um clique.

1. No VS Code, olhe a **barra vertical de ícones do lado esquerdo**.
2. Clique no quinto ícone, que parece **quatro quadradinhos** (um se soltando).
   Ao passar o mouse aparece o nome **Extensions**.
3. No campo de busca escrito **"Search Extensions in Marketplace"**, digite: `Live Server`.
4. O primeiro resultado é **Live Server**, do autor **Ritwick Dey**. Clique nele.
5. Clique no botão azul **Install**.
6. Quando o botão virar **Uninstall / Disable**, está instalado.

**0.3 — Instalar o Git**

O Git é o programa que envia seus arquivos para o GitHub.

1. Vá em `https://git-scm.com/downloads`.
2. Clique no seu sistema (**Windows** / **macOS**).
3. **Windows:** baixe o instalador, abra e clique **Next** em todas as telas
   (as opções padrão estão certas). No final, clique **Install** e depois **Finish**.
4. **Mac:** o jeito mais simples é abrir o app **Terminal** (aperte `Cmd + Espaço`, digite
   `Terminal`, `Enter`), digitar `git --version` e apertar `Enter`. O Mac abre uma janela
   perguntando se quer instalar as ferramentas de desenvolvedor: clique **Instalar**.

### Como testar se deu certo

1. No VS Code, no menu superior, clique em **Terminal → New Terminal**.
   Uma faixa preta/escura aparece embaixo da tela. Isso é o terminal.
2. Clique dentro dela, digite exatamente:
   ```
   git --version
   ```
   e aperte `Enter`.
3. Deve aparecer algo como `git version 2.45.0`. Se apareceu um número de versão, deu certo.

### Erros mais comuns nesta etapa

| Erro | O que significa | Como resolver |
|---|---|---|
| `git : O termo 'git' não é reconhecido` (Windows) | O Windows não achou o Git | Feche o VS Code **completamente** e abra de novo. Se persistir, reinstale o Git marcando a opção "Git from the command line and also from 3rd-party software" |
| `command not found: git` (Mac) | Ferramentas não instaladas | Rode `xcode-select --install` no Terminal e aceite a instalação |
| Não acho o ícone de Extensions | Barra lateral escondida | Menu **View → Extensions**, ou aperte `Ctrl+Shift+X` (Mac: `Cmd+Shift+X`) |

---

## Etapa 1 — Criar conta e projeto no Supabase

O Supabase vai ser seu banco de dados e seu sistema de login. É gratuito para começar.

### O que fazer, clique por clique

**1.1 — Criar a conta**

1. Vá em `https://supabase.com`.
2. No canto superior direito, clique no botão verde **Start your project**.
3. Aparece a tela de login com duas opções principais:
   - **Continue with GitHub** (recomendado — você vai precisar de conta no GitHub de qualquer jeito)
   - **Continue with Email**
4. Escolhendo GitHub: clique em **Continue with GitHub**, faça login (ou crie uma conta
   clicando em **Create an account**) e depois clique no botão verde **Authorize supabase**.
5. Você cai no **Dashboard** — uma tela escura com o título **Your Projects**.

**1.2 — Criar a organização (só aparece na primeira vez)**

1. Se aparecer a tela **Create a new organization**:
   - **Name**: digite algo como `Rota Segura`.
   - **Type**: escolha **Personal**.
   - **Plan**: deixe em **Free**.
2. Clique em **Create organization**.

**1.3 — Criar o projeto**

1. Clique no botão verde **New project**.
2. Preencha:
   - **Project name**: `rota-segura`
   - **Database Password**: clique em **Generate a password** para o Supabase criar uma senha forte.
     **Copie essa senha e guarde em um lugar seguro** (bloco de notas, gerenciador de senhas).
     Ela é a senha de administrador do banco. Você provavelmente nunca vai usar nesse projeto,
     mas o Supabase não mostra de novo.
   - **Region**: escolha a mais perto do Brasil — normalmente **South America (São Paulo)**.
   - **Pricing Plan**: **Free**.
3. Clique em **Create new project**.
4. Espere. Aparece uma barra de progresso e a frase "Setting up your project". Leva de **1 a 3 minutos**.

### Como testar se deu certo

- No menu lateral esquerdo, clique no ícone de **tabela** (nome: **Table Editor**).
- Se abrir uma tela dizendo que não há tabelas ainda, ou mostrando apenas o schema `public` vazio,
  o projeto está no ar. Não tem problema estar vazio — vamos criar as tabelas na Etapa 2.

### Erros mais comuns nesta etapa

| Erro | Como resolver |
|---|---|
| "Free plan limit reached" | Sua conta já tem 2 projetos grátis. Vá em **Your Projects**, abra um projeto antigo, **Settings → General → Pause project** (ou **Delete project**) |
| O projeto fica "Setting up" por mais de 10 minutos | Recarregue a página (`F5`). Se continuar, delete e crie de novo escolhendo outra Region |
| Perdi a Database Password | Vá em **Project Settings → Database → Database password → Reset database password** |

---

## Etapa 2 — Rodar o SQL (criar o banco)

Aqui você cria todas as tabelas, índices, gatilhos e as regras de segurança de uma vez só.

### O que fazer, clique por clique

1. Com o projeto aberto no Supabase, olhe o **menu lateral esquerdo**.
2. Clique no ícone que parece um **terminal / `>_`**, chamado **SQL Editor**.
   (Se o menu estiver recolhido, passe o mouse para ver os nomes.)
3. No topo da área central, clique em **+ New query** (ou no botão **+** ao lado de "Queries").
4. Abre um editor de texto grande e vazio no meio da tela.
5. No seu computador, abra o arquivo **`sql/schema.sql`** do projeto (arraste ele para dentro
   do VS Code, ou abra com o Bloco de Notas).
6. Selecione **TUDO** (`Ctrl+A` / `Cmd+A`) e copie (`Ctrl+C` / `Cmd+C`).
7. Volte ao Supabase, clique dentro do editor vazio e cole (`Ctrl+V` / `Cmd+V`).
8. Clique no botão verde **Run** no canto inferior direito do editor
   (ou aperte `Ctrl+Enter` / `Cmd+Enter`).

### Como testar se deu certo

**Teste 1 — a mensagem:**
Logo abaixo do editor deve aparecer, em fundo escuro: **`Success. No rows returned`**.
Essa é a mensagem de sucesso. Ela **não** significa que nada aconteceu: significa que os
comandos rodaram e não devolveram linhas (o que é o esperado ao criar tabelas).

**Teste 2 — as tabelas:**
1. Menu esquerdo → **Table Editor**.
2. No topo, em **schema**, deixe **public** selecionado.
3. Na lista lateral você deve ver, em ordem alfabética:
   `emergency_contacts`, `notifications`, `police_stations`, `post_likes`, `posts`,
   `profiles`, `reports`, `route_history`, `support_points`.
   São **9 tabelas**.

**Teste 3 — a segurança (RLS):**
1. Menu esquerdo → **Authentication** → aba **Policies**
   (em algumas versões: **Database → Policies**).
2. Cada uma das 9 tabelas deve mostrar a etiqueta verde **RLS enabled** e ter políticas listadas
   embaixo (ex.: `relatos_leitura`, `relatos_insert_proprio`).
3. Se alguma tabela mostrar **RLS disabled** em vermelho, o SQL não rodou inteiro — rode de novo.

**Teste 4 — o bucket de imagens:**
1. Menu esquerdo → **Storage**.
2. Deve existir um bucket chamado **rota-segura**, marcado como **Public**.

### Erros mais comuns nesta etapa

| Mensagem de erro | O que aconteceu | Como resolver |
|---|---|---|
| `ERROR: syntax error at or near ...` | Você colou só um pedaço do arquivo | Apague tudo do editor, copie o `schema.sql` **inteiro** de novo e rode outra vez |
| `ERROR: relation "profiles" already exists` | Você já rodou antes | Pode ignorar: o script usa `create table if not exists`. Se aparecer mesmo assim, apague as tabelas em Table Editor e rode de novo |
| `ERROR: must be owner of table objects` (na parte de Storage) | Sua conta não tem permissão nas policies do Storage por SQL | Crie as regras pela interface: **Storage → rota-segura → Policies → New policy → For full customization**, e recrie as três policies do arquivo |
| `permission denied for schema auth` | Raro, em projetos antigos | Rode o script em partes: primeiro tudo até a seção 11, depois o restante |
| Rodou, mas o Table Editor está vazio | Você está olhando outro schema | No seletor **schema**, no topo, troque para **public** |

---

## Etapa 3 — Pegar a URL e a chave anon

São os dois valores que fazem o app conversar com o seu banco.

### Onde encontrar cada coisa, exatamente

1. No menu lateral esquerdo, lá embaixo, clique no ícone de **engrenagem**: **Project Settings**.
2. Dentro de Project Settings, no submenu, clique em **API**
   (em versões mais novas o item pode se chamar **API Keys** ou **Data API**).
3. Agora olhe a tela central:

   **Bloco "Project URL"** (ou "URL", dentro de "Data API")
   - Campo com um endereço parecido com: `https://abcdefghijklmnop.supabase.co`
   - Esse é o seu **SUPABASE_URL**.
   - Clique no ícone de **duas folhinhas** (Copy) do lado direito do campo.

   **Bloco "Project API keys"** (ou "API Keys")
   - Tem duas ou três chaves listadas. Você quer a que estiver marcada como:
     - **`anon` `public`** (nome antigo), **ou**
     - **Publishable key**, começando com `sb_publishable_...` (nome novo).
   - Ela é uma sequência longa de letras e números. Clique em **Copy** ou no olhinho **Reveal**
     e depois copie.
   - Esse é o seu **SUPABASE_ANON_KEY**.

4. **A chave que você NÃO pode usar:** a que está marcada como **`service_role` `secret`**
   (ou **Secret key**, `sb_secret_...`). Ela aparece embaixo, geralmente escondida atrás de
   um botão **Reveal** com um aviso vermelho.
   Essa chave **ignora todas as regras de segurança**. Ela nunca entra em arquivo de frontend,
   nunca vai para o GitHub, nunca aparece no navegador.

5. Cole as duas informações que você copiou em um bloco de notas por enquanto.

### Como testar se deu certo

- A URL termina em `.supabase.co` e **não** tem barra no final.
- A chave anon tem mais de 100 caracteres e **não** contém a palavra `service_role`
  (você pode conferir colando ela em `https://jwt.io` no campo da esquerda, se ela for do
  formato antigo: no painel da direita deve aparecer `"role": "anon"`).

### Erros mais comuns nesta etapa

| Problema | Como resolver |
|---|---|
| Não acho "Project Settings" | Ele fica no **final** do menu lateral esquerdo, com ícone de engrenagem. Em telas pequenas pode ser preciso rolar o menu |
| Copiei a chave errada | Se ela começa com `sb_secret_` ou está marcada `service_role`, é a errada. Volte e copie a `anon`/`publishable` |
| A chave aparece coberta por bolinhas | Clique em **Reveal** (ícone de olho) para mostrar, depois em **Copy** |

---

## Etapa 4 — Configurar a autenticação

### O que fazer, clique por clique

**4.1 — Decidir sobre a confirmação de e-mail**

Por padrão o Supabase exige que a pessoa clique num link no e-mail antes de conseguir entrar.
Isso é o certo para produção, mas atrapalha os primeiros testes (o e-mail gratuito do Supabase
é limitado a poucos envios por hora).

**Sugestão: desligue agora para testar, ligue depois de publicar.**

1. Menu lateral esquerdo → **Authentication**.
2. No submenu, clique em **Providers** (em algumas versões: **Sign In / Providers**).
3. Na lista, clique em **Email**.
4. Procure a chave **Confirm email**.
   - **Desligada (cinza)** = a pessoa entra na hora após criar a conta. Bom para testar.
   - **Ligada (verde)** = precisa confirmar o e-mail antes.
5. Deixe **Enable Email provider** **ligado** (verde). Sem isso ninguém cria conta.
6. Clique em **Save**.

**4.2 — Configurar as URLs de redirecionamento**

É aqui que você diz ao Supabase para onde mandar a pessoa depois que ela clica no link
de recuperação de senha. Se você não fizer isso, o link do e-mail leva para o lugar errado.

1. Ainda em **Authentication**, clique em **URL Configuration**.
2. No campo **Site URL**, coloque, por enquanto:
   ```
   http://127.0.0.1:5500
   ```
3. No bloco **Redirect URLs**, clique em **Add URL** e adicione, uma por vez:
   ```
   http://127.0.0.1:5500/**
   http://localhost:5500/**
   ```
   (o `/**` no final autoriza qualquer página dentro do site)
4. Clique em **Save changes**.

> Na Etapa 9 você volta aqui e adiciona o endereço do GitHub Pages.

**4.3 — Conferir a política de senha (opcional)**

1. **Authentication → Policies** ou **Authentication → Sign In / Providers → Email**.
2. Se existir o campo **Minimum password length**, deixe em `6` (o valor que o app valida)
   ou aumente para `8` — nesse caso, ajuste também a mensagem em `js/auth.js`.

### Como testar se deu certo

Este teste só fecha na Etapa 7, depois do app rodar. Por enquanto, confira visualmente:
- **Email provider**: ligado.
- **Site URL**: `http://127.0.0.1:5500`.
- **Redirect URLs**: as duas linhas com `/**`.

### Erros mais comuns nesta etapa

| Erro | Como resolver |
|---|---|
| Criei a conta mas não recebo o e-mail | O envio gratuito do Supabase é limitado (poucos por hora) e cai muito em spam. Para testar, desligue **Confirm email** |
| Cliquei no link do e-mail e caiu numa página em branco / `localhost` recusou conexão | A **Site URL** está errada, ou o Live Server não estava aberto. Corrija a Site URL e peça um novo link |
| "requested path is invalid" ao abrir o link de recuperação | Falta o endereço em **Redirect URLs**. Adicione com `/**` no final |

---

## Etapa 5 — Colocar os arquivos no computador e configurar

### O que fazer, clique por clique

**5.1 — Organizar a pasta**

1. Crie uma pasta no seu computador, por exemplo em **Documentos**, chamada `rota-segura`.
2. Coloque dentro dela todos os arquivos do projeto, mantendo a estrutura:
   ```
   rota-segura/
     index.html
     README.md
     GUIA_PASSO_A_PASSO.md
     .gitignore
     .env.example
     css/
     js/
     pages/
     sql/
     assets/
   ```
3. Abra o VS Code.
4. Menu **File → Open Folder...** (Mac: **File → Open...**).
5. Selecione a pasta `rota-segura` e clique em **Selecionar pasta** / **Open**.
6. Se aparecer a pergunta **"Do you trust the authors of the files in this folder?"**,
   clique em **Yes, I trust the authors**.
7. Agora, na coluna da esquerda (**Explorer**), você vê todas as pastas do projeto.

**5.2 — Colar suas chaves**

1. Na coluna da esquerda, clique na pasta **js** para abrir.
2. Clique no arquivo **config.js**.
3. Procure estas duas linhas (estão logo no começo, depois dos comentários):
   ```js
   export const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
   export const SUPABASE_ANON_KEY = 'COLE_AQUI_SUA_CHAVE_ANON';
   ```
4. Substitua **apenas o que está entre as aspas** pelos valores que você copiou na Etapa 3.
   Ficará parecido com:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
   export const SUPABASE_ANON_KEY = 'sb_publishable_A1b2C3d4...';
   ```
   **Cuidado:** não apague as aspas simples `'` nem o ponto e vírgula `;` do final.
5. Salve com `Ctrl+S` (Mac: `Cmd+S`). A bolinha branca ao lado do nome do arquivo
   na aba superior deve sumir — isso significa "salvo".

**5.3 — Ajustar o centro do mapa (opcional)**

Ainda no `config.js`, a linha `centroPadrao: [-22.9068, -43.1729]` é o Rio de Janeiro.
É só o ponto inicial caso o GPS seja negado. Pode deixar como está.

### Como testar se deu certo

1. No VS Code, abra `js/config.js` de novo.
2. Confira que não sobrou nenhuma palavra `SEU-PROJETO` nem `COLE_AQUI`.
3. Confira que cada linha termina com `';` — sem espaços sobrando dentro das aspas.

### Erros mais comuns nesta etapa

| Erro | Sintoma | Como resolver |
|---|---|---|
| Apagou uma aspa | O VS Code pinta o arquivo todo de vermelho/laranja | Desfaça com `Ctrl+Z` e refaça com cuidado |
| Colou a URL com barra no final | O app não conecta | Deixe `https://xxx.supabase.co` sem `/` no fim |
| Colou a chave com espaço no começo | Erro "Invalid API key" no console | Apague os espaços |
| Salvou o arquivo errado | Nada muda | Confirme que a aba aberta é **config.js**, dentro da pasta **js** |

---

## Etapa 6 — Rodar o projeto localmente

### O que fazer, clique por clique

1. No VS Code, na coluna da esquerda, clique com o **botão direito** no arquivo **index.html**
   (o que está na raiz, não dentro de `pages`).
2. No menu que abre, clique em **Open with Live Server**.
3. Seu navegador abre sozinho em um endereço como:
   ```
   http://127.0.0.1:5500/index.html
   ```
4. Você deve ver a tela rosa de boas-vindas com o escudo, o título **Rota Segura** e os
   botões **Entrar** e **Criar conta**.

> **Alternativa sem Live Server:** no terminal do VS Code (**Terminal → New Terminal**),
> dentro da pasta do projeto, digite `python3 -m http.server 5500` (ou `python -m http.server 5500`
> no Windows) e depois abra `http://localhost:5500` no navegador.

### Como testar se deu certo

**Teste do console (importante, faça sempre):**
1. Com a página aberta no navegador, aperte `F12` (ou clique com botão direito → **Inspecionar**).
2. Clique na aba **Console**.
3. **Não deve haver linhas vermelhas.** Alguns avisos amarelos são normais.
4. Se aparecer em vermelho `[Rota Segura] As chaves do Supabase não foram configuradas`,
   volte à Etapa 5.

### Erros mais comuns nesta etapa

| Erro no console | Significado | Solução |
|---|---|---|
| `Access to script at 'file:///...' has been blocked by CORS policy` | Você abriu o HTML com dois cliques, sem servidor | Use **Open with Live Server** |
| `Failed to load module script: Expected a JavaScript module...` | Mesmo problema acima | Use o Live Server |
| `Failed to fetch` nas chamadas do Supabase | URL errada ou sem internet | Confira a `SUPABASE_URL` em `js/config.js` |
| `Invalid API key` | Chave errada ou incompleta | Copie de novo a chave **anon/publishable** |
| A página abre toda sem estilo, texto preto no branco | Os arquivos CSS não foram encontrados | Confira se a pasta `css` está no mesmo nível do `index.html` |
| O mapa aparece cinza, sem ruas | O Leaflet não carregou ou o container tem altura 0 | Recarregue com `Ctrl+Shift+R`; confira se a página `mapa.html` está com as duas linhas do Leaflet (CSS no `<head>` e JS antes do `app.js`) |

---

## Etapa 7 — Testar tudo (checklist)

Faça na ordem. Cada item tem "o que fazer" e "o que tem que acontecer".

**7.1 — Criar conta**
- Na tela inicial, clique em **Criar conta**.
- Preencha nome, e-mail (pode ser um e-mail real seu), telefone (opcional), senha com 6+
  caracteres, confirme a senha, marque as duas caixinhas e clique em **CRIAR CONTA**.
- ✅ Esperado: você vai direto para o mapa (se **Confirm email** estiver desligado), ou vê a
  mensagem verde pedindo para confirmar o e-mail.
- ✅ Confirme no Supabase: **Authentication → Users**. Seu e-mail deve estar na lista.
- ✅ Confirme também: **Table Editor → profiles**. Deve existir uma linha com o seu nome.
  Isso prova que o gatilho `on_auth_user_created` funcionou.

**7.2 — Validações do formulário**
- Tente criar conta com senhas diferentes → ✅ mensagem "As senhas não são iguais."
- Tente sem marcar os aceites → ✅ mensagem laranja pedindo o aceite.
- Tente com e-mail sem `@` → ✅ "Digite um e-mail válido."

**7.3 — Logout e login**
- No mapa, clique no **ícone de menu** (três risquinhos, canto superior direito) → **Sair da conta**.
- ✅ Volta para a tela de login.
- Faça login com o mesmo e-mail e senha → ✅ vai para o mapa.
- Tente entrar com a senha errada → ✅ "E-mail ou senha incorretos." (e não algo como
  "esse e-mail não existe" — é de propósito, para não entregar informação).

**7.4 — Proteção das páginas**
- Estando deslogada, digite direto na barra do navegador:
  `http://127.0.0.1:5500/pages/mapa.html`
- ✅ Esperado: você é jogada de volta para a tela de login.

**7.5 — Recuperação de senha**
- Na tela de login, clique em **Esqueci minha senha**.
- Digite seu e-mail e clique em **ENVIAR LINK**.
- ✅ Mensagem verde neutra aparece (mesmo se o e-mail não existir — isso é proposital).
- Abra o e-mail, clique no link → ✅ abre `nova-senha.html`.
- Digite a nova senha duas vezes e salve → ✅ mensagem de sucesso e volta ao login.
- Entre com a nova senha → ✅ funciona.

**7.6 — GPS**
- Ao abrir o mapa pela primeira vez, o navegador pergunta
  **"Permitir que 127.0.0.1 acesse sua localização?"** → clique em **Permitir**.
- ✅ Aparece um ponto azul com um círculo rosa em volta (a área de precisão).
- Agora teste a negativa: clique no **cadeado** ao lado do endereço no navegador →
  **Localização → Bloquear** → recarregue.
- ✅ O app **não quebra**: aparece a faixa branca no mapa com o texto
  "Não foi possível acessar sua localização. Você pode pesquisar um endereço manualmente."

**7.7 — Busca de endereço**
- No campo **"Para onde você quer ir?"**, digite uma rua conhecida com a cidade,
  por exemplo: `Avenida Atlântica, Rio de Janeiro`.
- Espere meio segundo → ✅ aparece a lista de sugestões.
- Clique em uma → ✅ o mapa centraliza, coloca um marcador escuro, e logo abaixo do mapa
  aparece o cartão com "Nenhum relato registrado próximo a este local."

**7.8 — Cadastrar relato**
- Clique no botão **+** rosa, no centro da barra de baixo.
- ✅ Abre o modal **"O que você deseja cadastrar?"** com três opções.
- Clique em **Cadastrar relato**.
- Escolha o tipo **Assédio verbal**, clique em **Usar minha localização**
  (ou pesquise um endereço), confira que a data e a hora vieram preenchidas,
  escreva uma descrição e clique em **ENVIAR RELATO**.
- ✅ Esperado: aviso verde "Relato enviado. Obrigada por contribuir.", o modal fecha,
  o relato aparece na lista **Relatos de segurança** e um marcador rosa aparece no mapa.
- ✅ Confirme no Supabase: **Table Editor → reports**. Deve haver uma linha nova com
  seu `user_id`, `lat`, `lng` e `status = approved`.

**7.9 — Cadastrar ponto de apoio / delegacia**
- Botão **+** → **Cadastrar ponto de apoio ou delegacia**.
- Escolha **Delegacia** → aparece a caixinha "É uma Delegacia de Atendimento à Mulher (DEAM)".
- Preencha nome, localização e salve.
- ✅ Aparece um marcador roxo no mapa.
- ✅ Confirme em **Table Editor → police_stations**.
- Repita escolhendo **Farmácia** → ✅ vai para **support_points** e o marcador é verde.

**7.10 — Segurança (RLS) na prática**
- Crie uma **segunda conta** (use outro e-mail, ou uma aba anônima).
- ✅ Com a segunda conta, você **vê** o relato criado pela primeira (é público e aprovado).
- ✅ Mas não consegue apagar nem editar — as políticas de RLS bloqueiam.
  Para conferir de verdade: abra o **Console** (`F12`) logado na segunda conta e rode:
  ```js
  const { error } = await window.supabaseTeste.from('reports').delete().eq('id','ID_DO_RELATO');
  ```
  Se você não expôs o cliente globalmente, basta confiar nas policies listadas na Etapa 2.

**7.11 — Responsividade**
- Com o `F12` aberto, clique no ícone de **celular/tablet** (Toggle device toolbar).
- Teste em **iPhone SE**, **iPad** e depois feche e olhe em tela cheia de notebook.
- ✅ No celular: tudo empilhado. No notebook: mapa à esquerda, relatos à direita.

### Erros mais comuns nesta etapa

| Erro | Causa | Solução |
|---|---|---|
| `new row violates row-level security policy for table "reports"` | O `user_id` enviado não é o da sessão, ou a sessão expirou | Saia e entre de novo. Confira que as policies `relatos_insert_proprio` existem |
| Relato salvou mas não aparece no mapa | O mapa está mostrando outra região | Clique no botão de **recentralizar** (alvo, canto inferior direito do mapa) |
| A busca de endereço não devolve nada | Faltou contexto, ou o número da casa não está mapeado no OpenStreetMap | Escreva "rua + cidade", ex.: `Rua da Paz, Niterói`. Se só a rua aparecer (marcada como "sem número exato"), é porque aquele número específico ainda não existe na base gratuita — ajuste o pino arrastando |
| Erro `403` ao enviar imagem do relato | Policy do Storage | Confira em **Storage → rota-segura → Policies** se existe a policy de insert por pasta do usuário |
| `Sua sessão expirou` | Token vencido | Faça login de novo |

---

## Etapa 8 — Publicar no GitHub Pages

### O que fazer, clique por clique

**8.1 — Criar a conta no GitHub (se ainda não tiver)**

1. Vá em `https://github.com` → botão **Sign up** no canto superior direito.
2. Preencha e-mail, senha e um nome de usuário (ele vai aparecer no endereço do seu site).
3. Confirme o e-mail que o GitHub envia.

**8.2 — Criar o repositório**

1. Logada no GitHub, clique no **+** no canto superior direito → **New repository**.
2. Preencha:
   - **Repository name**: `rota-segura`
   - **Description**: opcional
   - Marque **Public** (o GitHub Pages gratuito exige repositório público)
   - **NÃO** marque "Add a README file" (você já tem um)
3. Clique no botão verde **Create repository**.
4. A próxima tela mostra comandos. **Não feche essa aba** — você vai copiar o endereço dela.

**8.3 — Enviar os arquivos (pelo terminal do VS Code)**

1. No VS Code, com a pasta do projeto aberta: **Terminal → New Terminal**.
2. Digite os comandos abaixo **um por vez**, apertando `Enter` depois de cada um.

   Configurar seu nome (só na primeira vez na vida):
   ```
   git config --global user.name "Seu Nome"
   git config --global user.email "seu@email.com"
   ```

   Preparar e enviar:
   ```
   git init
   git add .
   git commit -m "Bloco 1: fundacao do Rota Segura"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/rota-segura.git
   git push -u origin main
   ```
   Troque `SEU-USUARIO` pelo seu nome de usuário do GitHub.

3. Vai abrir uma janela pedindo para autorizar: clique em **Sign in with your browser**,
   faça login no GitHub e clique em **Authorize**.

> **Alternativa sem terminal:** na tela do repositório recém-criado, clique em
> **uploading an existing file**, arraste todas as pastas e arquivos do projeto para a área
> indicada, e clique em **Commit changes**. Funciona, mas o terminal é melhor para as próximas
> atualizações.

**8.4 — Ligar o GitHub Pages**

1. Na página do seu repositório, clique na aba **Settings** (engrenagem, na barra superior
   do repositório — não a de configurações da sua conta).
2. No menu lateral esquerdo, clique em **Pages**.
3. Em **Source**, escolha **Deploy from a branch**.
4. Em **Branch**, escolha **main** e, na caixinha ao lado, **/ (root)**.
5. Clique em **Save**.
6. Espere de 1 a 3 minutos e recarregue a página. No topo aparece uma faixa verde:
   **"Your site is live at https://SEU-USUARIO.github.io/rota-segura/"**.
7. Copie esse endereço.

### Como testar se deu certo

- Abra o endereço `https://SEU-USUARIO.github.io/rota-segura/` no navegador.
- ✅ A tela rosa de boas-vindas carrega.
- ⚠️ O **login ainda pode falhar** neste momento — falta a Etapa 9.

### Erros mais comuns nesta etapa

| Erro | Solução |
|---|---|
| `remote origin already exists` | Rode `git remote remove origin` e repita o comando `git remote add ...` |
| `Support for password authentication was removed` | Use **Sign in with your browser** na janela do Git, ou instale o **GitHub CLI** |
| `failed to push some refs` | Rode `git pull origin main --allow-unrelated-histories` e depois `git push` de novo |
| Página 404 no endereço do Pages | Faltou o `index.html` na raiz, ou o Pages ainda está publicando. Espere 3 min e recarregue com `Ctrl+Shift+R` |
| O site abre sem CSS | Você colocou a pasta do projeto dentro de outra pasta no repositório. A raiz do repositório precisa ter o `index.html` |
| Site atualiza velho depois de mudar arquivos | Cache. Recarregue com `Ctrl+Shift+R` e confira em **Actions** se o deploy terminou |

---

## Etapa 9 — Ajustar o Supabase para o site publicado

Sem isso, o login funciona no seu computador, mas não no site publicado.

### O que fazer, clique por clique

1. Volte ao Supabase → **Authentication → URL Configuration**.
2. Em **Site URL**, troque para o endereço do seu site (com a barra final):
   ```
   https://SEU-USUARIO.github.io/rota-segura/
   ```
3. Em **Redirect URLs**, clique em **Add URL** e adicione:
   ```
   https://SEU-USUARIO.github.io/rota-segura/**
   ```
   Mantenha também as linhas de `127.0.0.1` e `localhost` — assim você continua conseguindo
   testar no seu computador.
4. Clique em **Save changes**.

### Como testar se deu certo

1. Abra o site publicado numa **aba anônima** (`Ctrl+Shift+N`).
2. Crie uma conta nova → ✅ deve entrar no mapa.
3. Clique em **Esqueci minha senha**, peça o link, abra o e-mail
   → ✅ o link leva para `https://SEU-USUARIO.github.io/rota-segura/pages/nova-senha.html`.

### Erros mais comuns nesta etapa

| Erro | Solução |
|---|---|
| `requested path is invalid` ao abrir o link do e-mail | Falta o `/**` no fim da Redirect URL, ou a URL tem erro de digitação |
| O link do e-mail volta para `localhost` | A **Site URL** ainda é a antiga. Troque e peça um novo link |
| Login funciona no computador mas não no celular | Confira se você acessou o endereço `https://` do GitHub Pages, não o `127.0.0.1` |

---

## Etapa 10 — Localização: entendendo o que é erro e o que é limite do serviço

Esta etapa foi acrescentada depois dos primeiros testes. Ela explica os três problemas de
localização mais comuns e o que o app faz com cada um.

### 10.1 — "O mapa diz que estou numa rua que não é a minha"

**Por que acontece.** O navegador tem duas formas de descobrir onde você está:

| Aparelho | Como descobre | Erro típico |
|---|---|---|
| Celular ao ar livre | Satélites de GPS | 5 a 20 metros |
| Celular dentro de prédio | GPS fraco + antenas de celular | 50 a 300 metros |
| Notebook / desktop | Wi-Fi próximo e endereço de internet | **500 metros a 3 km** |

No notebook não existe chip de GPS. O navegador olha as redes Wi-Fi ao redor, compara com um
banco de dados da Google/Mozilla e chuta. Se o seu prédio não está nesse banco, ele usa o
endereço de internet do seu provedor — que pode apontar para a central da operadora em outro
bairro. **Isso não é bug do código, é limite físico do aparelho.**

**O que estava errado no código, e era culpa minha:** eu desenhava o círculo de precisão com um
limite de 300 metros. Se o navegador dissesse "estou errando por 2 km", o círculo mesmo assim
aparecia pequeno. Você via um ponto aparentemente certo, e não tinha como desconfiar. Isso foi
corrigido: agora o círculo mostra o tamanho real do erro.

**O que o app faz agora:**
- Não aceita mais posição guardada em cache (`maximumAge: 0`) — antes ele podia devolver onde
  você estava meia hora atrás.
- Fica ouvindo o GPS por até 15 segundos e guarda a **leitura mais precisa**, em vez de aceitar
  a primeira. O GPS melhora sozinho a cada leitura.
- Mostra o círculo de precisão do tamanho verdadeiro.
- Quando o erro passa de 100 m, aparece uma faixa amarela sobre o mapa dizendo
  "Localização aproximada — precisão de X m".

**Como testar:** abra o mapa, clique no ponto azul. O popup mostra a precisão em metros.
- No notebook: espere algo entre 500 m e 3 km. É o normal.
- No celular, na rua: espere algo entre 5 e 30 m.

**Como melhorar de verdade:** teste pelo celular, com o GPS do aparelho ligado
(Configurações → Localização → Alta precisão), ao ar livre. É o cenário real de uso do app.

### 10.2 — Como o local do relato é definido

Duas regras que valem para os dois formulários (relato e ponto de apoio):

**Regra 1 — o app usa a sua localização sozinho.** Assim que você abre o formulário, ele já
pede o GPS e preenche o endereço. Você não precisa clicar em nada nem marcar nada no mapa.
Se o mapa principal já sabia onde você está, o preenchimento é instantâneo.

**Regra 2 — pesquisar na tela principal não define nada.** O que você pesquisou lá é consulta.
O formulário sempre começa do zero e busca a sua localização de verdade.

A tela do formulário de **relato** fica nesta ordem:

1. Botão rosa **Usar minha localização** — para refazer a busca se quiser
2. Cartão verde **"Usando sua localização atual"**, com o endereço e as coordenadas
3. Mapinha de **conferência** — só para você bater o olho e ver se é ali
4. **"Não é aqui? Corrigir o local"** — recolhido, só abre se você precisar. Dentro dele:
   campo de pesquisa de endereço e a opção de arrastar o pino

Se o GPS falhar ou for negado, o cartão explica o motivo e o bloco de correção abre sozinho,
com o campo de pesquisa já em foco.

No formulário de **ponto de apoio**, a busca fica sempre visível: é o próprio campo
**"Endereço"**, logo abaixo do mapinha de conferência. Digitar ali mostra sugestões e escolher
uma move o pino — não é mais preciso abrir nada escondido. (Antes esse campo era só texto
solto e não movia o pino; foi por isso que relatos e pontos ficavam salvos na localização atual
mesmo depois de digitar outra rua.)

**Como testar:**
1. Clique no **+** → **Cadastrar relato**.
2. ✅ Esperado: o cartão mostra "Buscando sua localização..." e depois preenche sozinho com
   o endereço. Você consegue enviar o relato sem tocar no mapa.
3. Abra **"Não é aqui? Corrigir o local"**, pesquise outro endereço.
4. ✅ O cartão muda para "Usando o endereço pesquisado" e o pino se move.
5. Arraste o pino → ✅ muda para "Usando o ponto que você ajustou".
6. Envie e confira em **Table Editor → reports**: `lat` e `lng` são os do cartão.

### 10.3 — "A pesquisa não acha número, só rua"

**Por que acontece.** O mapa por trás da busca (OpenStreetMap) é feito por voluntários. No
Brasil, a maioria das ruas está mapeada, mas **a maioria dos números de casa não está**.
Quando você procura "Rua da Paz, 120" e o número 120 não existe na base, não tem serviço
gratuito que invente esse dado — o Google cobra justamente por ter uma base própria mais
completa.

**O que o app faz.** A busca (arquivo `js/geocoding.js`) usa o **Photon**, da Komoot — ele
entende sozinho "rua, número" no mesmo campo de texto, prioriza o que está perto da área que
você está vendo no mapa, e devolve o que existir: com número exato quando a base tem, ou só a
rua quando não tem. Quando falta o número, o resultado vem marcado com a etiqueta laranja
**"sem número exato"**, o pino cai no meio da rua, e o cartão avisa:
*"O número exato não existe no mapa. O pino está na rua — arraste até o ponto certo."*
Arrastar o pino resolve, e a coordenada salva é a certa.

> **Por que Photon e não outro serviço mais conhecido (Nominatim)?** O Nominatim — o serviço
> "oficial" do OpenStreetMap — proíbe explicitamente buscas "enquanto você digita" como a
> deste app, e bloqueia quem usa dessa forma. O Photon é feito exatamente para isso. Os dois
> são gratuitos e usam a mesma base de mapa por baixo, então a diferença é só essa.

**Como testar:**
- `Avenida Paulista, 1578, São Paulo` → deve achar com número exato (via bem mapeada).
- Uma rua residencial do seu bairro com número → provavelmente vem com a etiqueta
  "sem número exato". ✅ É o comportamento esperado: escolha, arraste o pino, pronto.

**Dica de digitação:** sempre inclua a cidade. `Rua X, 120, Niterói` funciona muito melhor
que `Rua X, 120`.

### 10.4 — "O aviso de localização aproximada não sai mais da tela"

Era um bug, e a causa era esta: o aviso era redesenhado toda vez que o GPS mandava uma leitura
nova. Como o `watchPosition` dispara várias vezes por minuto, ele reaparecia sozinho para
sempre — e não tinha botão de fechar.

Corrigido em três frentes:

- O aviso aparece **no máximo uma vez por sessão**, na primeira localização.
- Ele **some sozinho depois de 12 segundos**.
- Ganhou um **botão × para fechar**. Depois de fechado, não volta mais até você recarregar
  a página.

De quebra, o mapa só redesenha o ponto azul quando você anda mais de 8 metros ou quando a
precisão melhora de verdade. Antes ele piscava a cada leitura do GPS.

### Erros mais comuns desta etapa

| Problema | Causa | Solução |
|---|---|---|
| Mini-mapa aparece cinza, sem ruas | O mapa foi criado dentro de um modal escondido | Já tratado no código (`invalidateSize`). Se acontecer, feche e abra o modal de novo |
| O pino não arrasta no celular | Você está arrastando o mapa, não o pino | Segure em cima do pino por meio segundo antes de arrastar. Ou só toque no ponto desejado |
| A busca demora e não devolve nada | Sem internet, ou o serviço de geocodificação está fora do ar | Espere alguns segundos e tente de novo. O app já espera 500 ms depois que você para de digitar antes de buscar |
| A precisão do GPS não melhora nunca | Navegador sem permissão de alta precisão, ou dentro de prédio | No celular: Configurações → Localização → Alta precisão. Teste ao ar livre |
| A faixa amarela reaparece depois de fechada | Você recarregou a página | Normal: o "fechei este aviso" vale por sessão. Feche de novo |
| O formulário abre e não preenche o endereço | GPS negado para o site | Clique no cadeado ao lado do endereço no navegador → Localização → Permitir |

---

## Etapa 11 — Bloco 2: criar a conta e a chave no OpenRouteService

O Bloco 2 (rotas e navegação) calcula o caminho a pé entre dois pontos usando um serviço
chamado **OpenRouteService**. Ele é gratuito, mas exige uma chave pessoal (um código que
identifica quem está usando). Sem essa chave, o botão de calcular rota não funciona.

### O que fazer, clique por clique

**11.1 — Criar a conta**

1. Vá em `https://openrouteservice.org` e clique em **Sign in** (ou **Sign up**) no canto
   superior direito.
2. Preencha e-mail e senha (ou entre com Google/GitHub, se aparecer essa opção) e confirme
   o e-mail que eles mandarem.
3. **Não pede cartão de crédito.** Se em algum momento pedirem, pare e me avise — não é o
   fluxo esperado do plano gratuito.

**11.2 — Gerar a chave (token)**

1. Depois de logada, vá para o **Dashboard** (painel) do OpenRouteService —
   normalmente em `https://openrouteservice.org/dev/#/home`.
2. Procure a seção de **Tokens** (ou **API Keys**). Deve ter um formulário simples pedindo
   um nome para o token (pode ser algo como `rota-segura`) e o **tipo de plano** —
   escolha o gratuito (**Standard** ou **Free**).
3. Clique em **Create Token** (ou **Request token**).
4. Aparece uma chave — uma sequência longa de letras e números. Clique no ícone de copiar
   ao lado dela, ou selecione o texto todo com o mouse e copie (`Ctrl+C`).
5. **Cole essa chave em algum lugar seguro por enquanto** (um bloco de notas, por exemplo).
   Você vai usá-la na Etapa 12, dentro do Supabase — **nunca** em `js/config.js` nem em
   nenhum arquivo que vá para o GitHub.

**11.3 — Conferir o limite gratuito**

Na mesma tela do token (ou em **Plans**/**Pricing**), veja quantas requisições por dia o
plano gratuito permite. O número exato pode mudar com o tempo, mas para uso pessoal —
testando o app, calculando algumas rotas por dia — o plano gratuito é bem mais do que
suficiente.

### Como testar se deu certo

Por enquanto, o teste é visual: você tem uma chave copiada e sabe que a conta está ativa.
O teste de verdade (a chave calculando uma rota) acontece na Etapa 12, depois de ligar essa
chave à Edge Function do Supabase.

### Erros mais comuns nesta etapa

| Erro | Causa | Solução |
|---|---|---|
| Não chega e-mail de confirmação | Foi para o spam, ou demora | Confira a caixa de spam. Espere alguns minutos e tente reenviar |
| Não aparece opção de gerar token | Conta ainda não confirmou o e-mail | Confirme o e-mail primeiro |
| Pede cartão de crédito | Você pode estar num plano diferente do gratuito | Procure especificamente pelo plano **Standard**/**Free** |
| Perdi a chave depois de fechar a tela | O token some da visualização depois de gerado, por segurança | Normal em muitos serviços assim. Gere um novo token — o antigo continua funcionando, ou você pode revogá-lo |

---

## Etapa 12 — Bloco 2: publicar a Edge Function no Supabase

A chave do OpenRouteService **não pode** aparecer no código do site (ele é público, qualquer
pessoa vendo o código-fonte no navegador leria a chave). Por isso, quem fala com o
OpenRouteService é uma **Edge Function** — um pequeno programa que roda dentro do Supabase,
não no navegador da usuária. O site pede a rota para essa função; a função (que conhece a
chave, guardada em segredo) pede a rota para o OpenRouteService; a resposta volta pelo mesmo
caminho, sem a chave nunca aparecer no navegador.

Você vai criar essa função **direto pelo site do Supabase**, sem instalar nada no computador.

### O que fazer, clique por clique

**12.1 — Abrir a área de Edge Functions**

1. No painel do Supabase, com seu projeto aberto, olhe o **menu lateral esquerdo**.
2. Clique em **Edge Functions**.

**12.2 — Criar a função**

1. Clique no botão **Deploy a new function** (ou **Create a new function**).
2. Escolha a opção **Via Editor** (editar direto no navegador — nada de terminal).
3. Em **Name** (nome da função), digite exatamente: `calcular-rota`
   (o site chama a função por esse nome — se digitar diferente, precisa avisar para eu
   ajustar o código do site também).
4. Um editor de código abre, já com um exemplo pronto.

**12.3 — Colar o código**

1. No VS Code, abra o arquivo `supabase/functions/calcular-rota/index.ts` do projeto.
2. Selecione tudo (`Ctrl+A`) e copie (`Ctrl+C`).
3. Volte para o editor do Supabase, selecione todo o código de exemplo que já estava lá
   (`Ctrl+A`) e cole por cima (`Ctrl+V`), substituindo tudo.

**12.4 — Configurar o secret (a chave, guardada em segredo)**

1. Ainda em **Edge Functions**, procure por **Secrets** (ou **Manage secrets** /
   **Edge Function Secrets**) — geralmente uma aba ou um link perto do topo da página.
2. Clique em **Add new secret** (ou **New secret**).
3. Em **Name**, digite exatamente: `ORS_API_KEY`
4. Em **Value**, cole a chave do OpenRouteService que você copiou na Etapa 11.
5. Clique em **Save** (Salvar).

> Repare que o nome do secret (`ORS_API_KEY`) precisa ser **idêntico** ao que o código em
> `index.ts` procura (`Deno.env.get('ORS_API_KEY')`). Maiúsculas/minúsculas importam.

**12.5 — Publicar**

1. Volte para o editor da função (`calcular-rota`).
2. Clique em **Deploy function** (ou **Deploy**), geralmente no canto inferior direito
   do editor.
3. Espere a mensagem de sucesso (10 a 30 segundos).

**12.6 — Testar direto no Supabase, antes de mexer no site**

1. Na página da função, procure o botão/aba **Test** (ou **Invoke**).
2. No corpo da requisição (**Body**, em formato JSON), cole:
   ```json
   { "origem": { "lat": -22.9068, "lng": -43.1729 }, "destino": { "lat": -22.9519, "lng": -43.2105 } }
   ```
3. Clique em **Send request** (ou **Run**/**Invoke**).
4. ✅ Esperado: uma resposta com `distanciaM`, `duracaoS` e uma lista `geometria` cheia de
   pares de números. Isso confirma que a função, o secret e a chave do OpenRouteService
   estão todos certos.

### Como testar se deu certo

- O teste do passo 12.6 respondeu com números, sem a palavra `erro`. ✅

### Erros mais comuns nesta etapa

| Erro | Causa | Solução |
|---|---|---|
| `"O serviço de rotas não está configurado"` | O secret `ORS_API_KEY` não foi salvo, ou o nome está diferente | Repita o passo 12.4, conferindo o nome letra por letra |
| `"A chave do serviço de rotas não foi aceita"` | A chave colada no secret está errada ou incompleta | Volte ao OpenRouteService, copie a chave de novo com cuidado (sem espaços antes/depois) |
| `"Muitas rotas calculadas em pouco tempo"` | Bateu no limite de requisições do plano gratuito | Espere um pouco. Se acontecer sempre, confira o limite atual na Etapa 11.3 |
| `"Não encontramos um caminho a pé entre esses dois pontos"` | Os pontos estão em ilhas separadas, ou muito longe um do outro para uma caminhada | Teste com dois pontos mais próximos, na mesma cidade |
| Erro de CORS no console do navegador (F12) | A função não devolveu os cabeçalhos de CORS | Confira se colou o arquivo `index.ts` **inteiro**, sem cortar nada no começo/fim |
| `401` ao chamar pelo site (não pelo teste do Supabase) | Você não está logada no app, ou a sessão expirou | Faça login de novo em `login.html` |

---

## Etapa 13 — Bloco 2: testar rotas e navegação ativa

### O que fazer, clique por clique

**13.1 — Testar o cálculo de rota**

1. Com o Live Server rodando (Etapa 6), abra `pages/rotas.html` (ou clique em **Rotas** na
   barra de baixo do app, já logada).
2. O navegador vai pedir permissão de localização — clique em **Permitir**.
3. ✅ Esperado: o campo **Meu local** preenche sozinho com seu endereço, e o rótulo acima
   dele muda para **"Localização atual"**.
4. No campo **Destino**, digite um endereço qualquer da sua cidade e escolha uma sugestão.
5. ✅ Esperado: em alguns segundos aparece uma linha rosa no mapa ligando os dois pontos, e
   um cartão embaixo com o tempo e a distância (ex.: "12 min (850 m)").
6. Acima do formulário, toque em **"De carro"**. ✅ Esperado: a rota recalcula sozinha e o
   tempo cai bastante em relação ao "A pé" — é o mesmo trajeto, mas por um perfil diferente
   no OpenRouteService (`driving-car` em vez de `foot-walking`). Toque em "A pé" para voltar.
   Se comparar com o Google Maps, compare sempre o mesmo meio de transporte dos dois lados
   (o Maps mostra carro por padrão) — comparar "a pé" do app com "carro" do Maps dá números
   bem diferentes, e isso é esperado, não é bug.

**13.1.1 — Testar a partida digitada manualmente (sem depender do GPS)**

1. No campo **Meu local**, apague o texto e digite outro endereço (rua, número e cidade) —
   o mesmo jeito de buscar do campo Destino.
2. Escolha uma sugestão. ✅ Esperado: o rótulo acima muda para **"Endereço de partida"**, o
   pino no mapa fica azul (diferente do círculo que marca sua posição real), e a rota é
   recalculada a partir desse ponto.
3. Negue a permissão de localização (ou teste num navegador/aba sem GPS) e recarregue a
   página. ✅ Esperado: o campo mostra uma mensagem clara de que não achou sua localização,
   mas continua digitável — buscar um endereço manualmente funciona normalmente mesmo sem GPS.
4. Com uma partida digitada (não pelo GPS), clique em **Iniciar**. ✅ Esperado: o título muda
   para **"Prévia da rota"**, aparece um aviso amarelo explicando que não há acompanhamento
   de GPS em tempo real, e o pino não se move sozinho (porque não é a sua posição de verdade).

**13.2 — Testar o botão SOS**

1. Toque no painel rosa **"SOS emergência"**.
2. ✅ Esperado (até o Bloco 3 existir): uma mensagem explicando que ainda não há contato de
   emergência cadastrado, com os telefones 190/180 como alternativa. Isso é o comportamento
   correto por enquanto — o cadastro de contatos chega no Bloco 3.

**13.3 — Testar a navegação sem sair andando por aí (modo simulado de teste)**

> Não confunda com a "Prévia da rota" da 13.1.1: aquela é uma funcionalidade real (para quando
> você digita a partida em vez de usar o GPS). Este `?simular=1` aqui é só uma ferramenta de
> teste para você exercitar a detecção de "saiu da rota"/"chegada" sem sair andando — e exige
> uma partida por GPS (ou clique no mapa) para fazer sentido.

Para testar "sair da rota" e "chegar ao destino" de verdade, você precisaria literalmente
andar pela rua. Para testar sentada, o app tem um modo de simulação — **só para teste, nunca
ativo sozinho**.

1. Depois de calcular uma rota (passo 13.1), olhe o endereço na barra do navegador. Se for,
   por exemplo, `http://127.0.0.1:5500/pages/rotas.html`, adicione `?simular=1` no final:
   `http://127.0.0.1:5500/pages/rotas.html?simular=1` e aperte Enter.
2. ✅ Esperado: aparece uma faixa roxa no topo escrito **"MODO TESTE — GPS simulado"**.
3. Refaça a busca de destino (passo 13.1) e clique em **Iniciar**.
4. Toque em pontos do mapa, **seguindo mais ou menos a linha da rota**. A cada toque, o
   ponto azul (sua posição simulada) pula para lá, e a distância restante no cartão atualiza.
5. Agora toque bem longe da linha da rota (num bairro diferente, por exemplo) **duas vezes
   seguidas**. ✅ Esperado: aparece o aviso **"Você saiu da rota"**, com os botões
   **CONTINUAR NA ROTA ATUAL** e **ESCOLHER OUTRA ROTA**. O app não recalcula sozinho.
6. Toque bem perto do destino. ✅ Esperado: aparece **"Você chegou ao destino"**.

**13.4 — Testar o encerramento manual**

1. Calcule uma rota, clique em **Iniciar**.
2. Toque em **Encerrar rota** → aparece a confirmação **"Encerrar rota?"**.
3. Toque em **CONTINUAR** → ✅ a navegação continua normalmente.
4. Toque em **Encerrar rota** de novo → **ENCERRAR** → ✅ volta para a tela de planejamento.

**13.5 — Testar a navegação de verdade (opcional, mas recomendado ao menos uma vez)**

Sem o `?simular=1` na URL, saia para uma caminhada curta e real com o celular. Confirme que
o ponto azul acompanha você de verdade e que a distância restante diminui.

**13.6 — Publicar as novidades no GitHub Pages**

Se você já publicou o Bloco 1 (Etapa 8), **não precisa configurar o GitHub Pages de novo** —
é só enviar os arquivos novos:

1. No VS Code: **Terminal → New Terminal**.
2. Rode, um de cada vez:
   ```
   git add .
   git commit -m "Bloco 2: rotas e navegacao"
   git push
   ```
3. Espere 1 a 3 minutos e recarregue `https://SEU-USUARIO.github.io/rota-segura/` com
   `Ctrl+Shift+R`.

> O secret `ORS_API_KEY` mora no Supabase, não no GitHub — não precisa reconfigurar nada
> ligado a ele ao publicar.

### Como testar se deu certo

- Rota calculada e desenhada no mapa. ✅
- Botão Iniciar leva para a tela de navegação (sem voltar sozinho para o Mapa). ✅
- Modo simulado mostra o aviso de "saiu da rota" e de "chegada". ✅
- Site publicado mostra a Tela 2 funcionando igual ao localhost. ✅

### Erros mais comuns nesta etapa

| Erro | Causa | Solução |
|---|---|---|
| "Meu local" fica em "Buscando localização..." para sempre | Permissão de localização negada, ou GPS indisponível | Clique no cadeado ao lado do endereço no navegador → Localização → Permitir, e toque no botão de mira para tentar de novo |
| O cartão da rota mostra uma mensagem de erro | Falha ao chamar a Edge Function, ou o OpenRouteService não achou caminho | Confira a Etapa 12 (função publicada, secret certo). Tente dois pontos mais próximos |
| A faixa "MODO TESTE" não aparece | Faltou o `?simular=1` exatamente no final da URL, ou tem outro `?algo=` antes | Confira se a URL termina com `?simular=1` (sem espaços) |
| Tocar no mapa no modo simulado não move o ponto azul | Você tocou antes de clicar em **Iniciar** | O toque só simula GPS depois que a navegação está ativa |
| A barra de navegação (Mapa/Rotas/Alertas/Perfil) não some durante a navegação | Cache do navegador com CSS antigo | `Ctrl+Shift+R` para recarregar sem cache |

---

## Sobre o .env (leia antes de procurar por ele)

Você pediu para eu explicar como configurar o `.env`. Preciso ser direta sobre uma coisa
para você não perder tempo: **neste tipo de projeto o `.env` não funciona.**

Motivo: `.env` é um arquivo lido por um **programa que roda no servidor** (Node.js, Python)
ou por uma **ferramenta de build** (Vite, Webpack) antes de gerar o site. Este projeto é
HTML/CSS/JS puro, publicado direto no GitHub Pages, sem servidor e sem build. O navegador
simplesmente não tem como abrir um `.env`.

Se eu fingisse que dá certo, você ia passar horas tentando entender por que "não pega".

**O que fazer, então:**
- As chaves ficam em **`js/config.js`**, que é o equivalente de `.env` para este projeto.
- Isso **é seguro** para a chave `anon`: ela foi projetada para ficar visível no navegador.
  Quem protege seus dados é o **Row Level Security** que você criou na Etapa 2 — sem ele,
  aí sim qualquer pessoa leria tudo.
- O arquivo **`.gitignore`** que já está no projeto bloqueia o envio de `.env` e `*.key`
  por precaução, caso um dia você adicione um backend.
- O arquivo **`.env.example`** fica no projeto só como anotação de quais valores existem.

**A regra que nunca muda:** a chave `service_role` / `secret` **nunca** entra em arquivo
de frontend, nunca vai para o GitHub, nunca aparece no navegador. Se um dia ela vazar,
vá em **Project Settings → API → service_role → Revoke / Generate new key** imediatamente.

---

## Dicionário rápido

| Termo | O que é, em português simples |
|---|---|
| **Supabase** | Serviço que dá o banco de dados, o sistema de login e o armazenamento de arquivos, sem você precisar montar servidor |
| **Chave anon / publishable** | Senha pública do app. Pode ficar visível. Só funciona dentro das regras que você criou |
| **Chave service_role / secret** | Senha de administrador. Ignora todas as regras. Nunca no frontend |
| **RLS (Row Level Security)** | Regras que decidem, linha por linha, quem pode ver e alterar o quê |
| **Policy** | Uma dessas regras |
| **Trigger (gatilho)** | Comando que o banco executa sozinho quando algo acontece (ex.: criar o perfil quando alguém se cadastra) |
| **Bucket** | Pasta de arquivos no Storage |
| **Leaflet** | Biblioteca que desenha o mapa na tela |
| **OpenStreetMap** | Mapa gratuito e colaborativo, usado como base |
| **Photon** | Serviço gratuito (da Komoot, com dados do OpenStreetMap) que transforma endereço em coordenadas (e o contrário) |
| **Geocodificação** | Transformar "Rua da Paz, 100" em latitude e longitude |
| **Bounding box** | O retângulo que você está vendo no mapa. Usamos para buscar só os dados dessa área |
| **Repositório (repo)** | A pasta do seu projeto hospedada no GitHub |
| **Commit** | Um "salvamento" com descrição, no histórico do Git |
| **Push** | Enviar seus commits para o GitHub |
| **GitHub Pages** | Serviço gratuito que transforma seu repositório em site no ar |
| **Console (F12)** | Painel do navegador onde aparecem os erros. Seu melhor amigo quando algo não funciona |
| **OpenRouteService** | Serviço gratuito (Bloco 2) que calcula uma rota a pé entre dois pontos |
| **Edge Function** | Um pequeno programa que roda no Supabase, não no navegador — usado para esconder a chave do OpenRouteService |
| **Secret / variável de ambiente** | Um valor guardado em segredo no servidor (aqui, a chave do OpenRouteService), que o código nunca expõe |
| **GeoJSON** | Formato padrão para descrever pontos, linhas e áreas geográficas — é como a Edge Function recebe a rota do OpenRouteService |
| **watchPosition** | Função do navegador que avisa a cada nova leitura de GPS, usada para acompanhar você durante a navegação ativa |
