# Rota Segura — Blocos 1, 2 e 3 (completo)

Plataforma colaborativa de segurança para mulheres em deslocamentos urbanos.
Este repositório contém o projeto completo: **Bloco 1** (arquitetura, banco de dados,
autenticação e a **Tela 1 — Mapa de consulta**), **Bloco 2** (**Tela 2 — Rotas e navegação
ativa**) e **Bloco 3** (**Tela 3 — Comunidade**, Perfil, contatos de emergência, notificações
e menu).

> Começando do zero? Leia o **[GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md)** — ele explica
> cada clique no Supabase, no VS Code e no GitHub.

---

## O que já funciona

- Cadastro, login, logout e recuperação de senha reais (Supabase Auth)
- Proteção de páginas: sem sessão, ninguém entra no mapa
- Mapa Leaflet com o estilo CARTO Voyager (visual claro, quarteirões e ruas com contraste
  legível de perto, combina com a identidade rosa do app) sobre dados do OpenStreetMap, com
  localização do usuário e círculo de precisão
- Marcadores SVG diferentes por tipo: relatos, iluminação, pontos de apoio, delegacias, ônibus
- **Indicação visual de concentração de relatos**: cada relato desenha uma mancha vermelha
  translúcida no mapa; onde há vários próximos, as manchas se sobrepõem e a área fica
  visivelmente mais vermelha — dá pra perceber uma região com mais ocorrências num relance,
  sem abrir cada pino (legenda explicando isso abaixo do mapa da Tela 1)
- Busca de endereço com geocodificação real (Photon/OpenStreetMap), reconhecendo rua + número
  e priorizando a área visível do mapa. Quando o texto tem rua + número + cidade, uma segunda
  busca sem o número valida a cidade do resultado, evitando confundir bairros de nome parecido
  em cidades diferentes. Quando o número exato não está mapeado, o aviso "localização
  aproximada" continua visível mesmo depois de escolhido (não só na lista de sugestões)
- Seletor de local com mini-mapa e pino arrastável nos formulários, independente da busca da tela
- Precisão do GPS informada em metros, com aviso quando a localização está aproximada
- Contagem de relatos num raio de 500 m do endereço pesquisado
- Cadastro de relato (com upload opcional de imagem) e de ponto de apoio/delegacia, salvando no banco
- Lista "Relatos de segurança" vinda do banco, sem dados fixos no código
- Atualização em tempo real quando um relato novo é criado
- Estados de loading, erro, vazio e permissão negada em todas as funcionalidades
- Row Level Security cobrindo as 9 tabelas
- **Tela 2 — cálculo de rota a pé ou de carro** (seletor de meio de transporte, como no Maps)
  via OpenRouteService, chamado por uma Supabase Edge Function para a chave nunca ficar
  exposta no site. Origem por GPS **ou** digitada à mão (mesma busca do destino) — as duas
  continuam funcionando mesmo sem permissão de localização
- Card da rota anotado só com dados reais da plataforma (relatos e pontos de apoio próximos
  ao trajeto, também marcados no mapa) — nunca inventa iluminação ou movimento que o banco não tem
- **Navegação ativa** com GPS real quando a origem é a localização atual: aviso (sem recálculo
  automático) ao sair da rota, detecção de chegada e encerramento manual. Quando a origem foi
  digitada, mostra a rota como prévia em vez de fingir um GPS que não existe — inclui também
  um modo de simulação só para teste (`?simular=1`)
- **Compartilhar rota**: durante a navegação, um botão avisa seu contato de emergência pelo
  WhatsApp para onde você está indo e sua localização atual — diferente do SOS (que é para uma
  emergência já acontecendo), este é para avisar por precaução, antes de qualquer coisa
  acontecer. Os dois botões abrem a aba do WhatsApp de um jeito que não é bloqueado como pop-up
  pelo navegador (a aba abre no clique, ainda síncrona, e só recebe o link depois)
- **Tela 3 — Comunidade**: feed real do banco com filtro por categoria (Alerta/Dica/Apoio/
  Notícia), publicação com localização e imagem opcionais, e curtir/descurtir — de propósito,
  sem comentários, resposta ou compartilhamento. O contador de curtidas é mantido pelo próprio
  banco (gatilho), nunca calculado no navegador
- **Perfil completo**: dados editáveis (nome, telefone, avatar via Storage), troca de senha,
  "Meus relatos", "Minhas publicações" e "Histórico de rotas" vindos do banco
- **Contatos de emergência** com adicionar/editar/excluir — é o que alimenta o botão SOS da
  Tela 2 de verdade
- **Central de notificações** (sino no cabeçalho, com contador de não lidas): hoje só gera
  notificação real quando alguém curte sua publicação (via gatilho no banco) — nada fictício
  só para preencher a tela
- Menu expandido com Perfil, Meus relatos, Contatos de emergência, Notificações, Configurações
  (troca de senha), Termos de uso e Privacidade

---

## Estrutura

```
rota-segura/
├── index.html                 Tela inicial (Entrar / Criar conta)
├── pages/
│   ├── login.html
│   ├── cadastro.html
│   ├── recuperar-senha.html
│   ├── nova-senha.html
│   ├── mapa.html              TELA 1 — mapa de consulta
│   ├── rotas.html             TELA 2 — rotas e navegação ativa
│   ├── alertas.html           TELA 3 — comunidade (feed, filtros, curtidas)
│   └── perfil.html            Perfil, contatos de emergência, configurações
├── css/
│   ├── variables.css          tokens do design system
│   ├── global.css             reset e base
│   ├── components.css         botões, cards, modais, nav, toasts
│   ├── auth.css               telas de login/cadastro
│   ├── map.css                tela do mapa (e cabeçalho reaproveitado por alertas/perfil)
│   ├── rotas.css              tela de rotas e navegação ativa
│   ├── comunidade.css         feed, filtros e cartão de publicação da Tela 3
│   ├── perfil.css             cartão de perfil, seções e contatos de emergência
│   └── responsive.css         breakpoints
├── js/
│   ├── config.js              ⚠️ SUAS CHAVES VÃO AQUI
│   ├── supabase.js            cliente e tradução de erros
│   ├── auth.js                login, cadastro, recuperação, logout, guard
│   ├── map.js                 Leaflet, marcadores, consulta por área visível
│   ├── geolocation.js         GPS do navegador
│   ├── geocoding.js           Photon (endereço ⇄ coordenadas, reconhece rua + número)
│   ├── location-picker.js     mini-mapa com pino arrastável dos formulários
│   ├── search.js              barra de pesquisa da Tela 1
│   ├── reports.js             lista e formulário de relatos
│   ├── support-points.js      formulário de pontos de apoio e delegacias
│   ├── routes.js              TELA 2 — origem/destino, cálculo de rota, card de segurança
│   ├── navigation.js          navegação ativa: GPS real, saiu da rota, chegada
│   ├── emergency.js           SOS: link do WhatsApp com localização
│   ├── community.js           feed, filtros, curtir/descurtir, formulário de publicação
│   ├── alertas.js             ponto de entrada da TELA 3 (Comunidade)
│   ├── profile.js             ponto de entrada do Perfil: dados, listas, contatos, senha
│   ├── notifications.js       central de notificações (modal do sino)
│   ├── nav.js                 bottom navigation e contador do sino
│   ├── ui.js                  toasts, modais, loading, formatação
│   ├── icons.js               ícones SVG (nenhum emoji)
│   └── app.js                 ponto de entrada da Tela 1
├── supabase/functions/
│   └── calcular-rota/index.ts Edge Function: fala com o OpenRouteService, esconde a chave
├── sql/schema.sql             banco completo, pronto para colar no Supabase
├── assets/
├── .gitignore
└── .env.example
```

---

## Configuração rápida

1. Crie um projeto em `https://supabase.com`.
2. **SQL Editor → New query** → cole `sql/schema.sql` → **Run**.
3. **Project Settings → API** → copie **Project URL** e a chave **anon / publishable**.
4. Cole os dois valores em `js/config.js`.
5. **Authentication → URL Configuration** → adicione `http://127.0.0.1:5500/**` em Redirect URLs.
6. Abra `index.html` com a extensão **Live Server** do VS Code.

Isso já deixa o **Bloco 1** (login + mapa) funcionando. Para o **Bloco 2** (rotas), falta
criar uma conta gratuita no OpenRouteService e publicar a Edge Function
`supabase/functions/calcular-rota` pelo Dashboard do Supabase — sem terminal, tudo pelo
navegador. Cada passo está detalhado clique por clique no
[GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md) (Etapas 11 e 12). O **Bloco 3** (comunidade,
perfil, contatos de emergência) **não precisa de nenhuma configuração extra** — as tabelas,
o Storage e as regras de acesso já vêm no mesmo `sql/schema.sql` do passo 2.

---

## Banco de dados

| Tabela | Para que serve |
|---|---|
| `profiles` | Dados públicos do usuário (nome, telefone, avatar). Criada automaticamente por
  trigger no cadastro; editável na tela de Perfil |
| `emergency_contacts` | Contatos de emergência (privado, só a dona vê) — CRUD completo na
  tela de Perfil, usado de verdade pelo botão SOS |
| `reports` | Relatos de segurança com coordenadas, tipo, nível de atenção e status |
| `support_points` | Farmácias, hospitais, comércios 24h, pontos de ônibus |
| `police_stations` | Delegacias, com marcação de DEAM |
| `posts` | Publicações da comunidade — feed da Tela 3, com curtidas contadas em `likes_count` |
| `post_likes` | Curtidas, com restrição de uma por pessoa por publicação |
| `notifications` | Notificações do sino — hoje geradas quando alguém curte sua publicação |
| `route_history` | Histórico de rotas, mostrado na tela de Perfil |

**Moderação:** `reports`, `support_points`, `police_stations` e `posts` têm o campo `status`
com os valores `pending`, `approved` e `rejected`. No `schema.sql` o padrão é `approved` para
o app funcionar imediatamente. Para ativar a moderação prévia, troque o `default 'approved'`
por `default 'pending'` nessas tabelas.

---

## Segurança

- Apenas a chave **anon** (pública) está no frontend — é assim que a arquitetura do Supabase
  foi desenhada. Quem protege os dados é o RLS.
- A chave **service_role** nunca entra neste repositório.
- Senhas são gerenciadas pelo Supabase Auth; nenhuma senha é gravada em tabela nossa.
- Mensagens de erro de login e de recuperação de senha são genéricas de propósito,
  para não revelar se um e-mail está cadastrado.
- `.gitignore` bloqueia `.env`, `*.key` e `*.pem`.

---

## Acessibilidade e performance

- `aria-label` em todos os botões que só têm ícone, `role="status"` nas áreas que mudam sozinhas
- Foco visível, navegação por teclado, `Esc` fecha modais, link "Pular para o mapa"
- `prefers-reduced-motion` respeitado
- Debounce de 500 ms na busca, cache dos resultados de geocodificação
- Consulta geográfica por retângulo visível — nunca a base inteira

---

## Créditos de dados

Mapa: © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright), com o
estilo visual (tiles) Voyager da [CARTO](https://carto.com/attributions). Geocodificação:
[Photon](https://photon.komoot.io), da Komoot, também construído sobre dados do OpenStreetMap.
Cálculo de rotas: [OpenRouteService](https://openrouteservice.org), da HeiGIT. Use todos com
moderação — são serviços públicos gratuitos.
