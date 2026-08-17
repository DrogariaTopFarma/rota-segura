# Rota Segura — Blocos 1 e 2

Plataforma colaborativa de segurança para mulheres em deslocamentos urbanos.
Este repositório contém o **Bloco 1** (arquitetura, banco de dados, autenticação e a
**Tela 1 — Mapa de consulta**) e o **Bloco 2** (**Tela 2 — Rotas e navegação ativa**).

> Começando do zero? Leia o **[GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md)** — ele explica
> cada clique no Supabase, no VS Code e no GitHub.

---

## O que já funciona

- Cadastro, login, logout e recuperação de senha reais (Supabase Auth)
- Proteção de páginas: sem sessão, ninguém entra no mapa
- Mapa Leaflet + OpenStreetMap com localização do usuário e círculo de precisão
- Marcadores SVG diferentes por tipo: relatos, iluminação, pontos de apoio, delegacias, ônibus
- Busca de endereço com geocodificação real (Photon/OpenStreetMap), reconhecendo rua + número
  e priorizando a área visível do mapa
- Seletor de local com mini-mapa e pino arrastável nos formulários, independente da busca da tela
- Precisão do GPS informada em metros, com aviso quando a localização está aproximada
- Contagem de relatos num raio de 500 m do endereço pesquisado
- Cadastro de relato (com upload opcional de imagem) e de ponto de apoio/delegacia, salvando no banco
- Lista "Relatos de segurança" vinda do banco, sem dados fixos no código
- Atualização em tempo real quando um relato novo é criado
- Estados de loading, erro, vazio e permissão negada em todas as funcionalidades
- Row Level Security cobrindo as 9 tabelas
- **Tela 2 — cálculo de rota a pé** via OpenRouteService, chamado por uma Supabase Edge
  Function para a chave nunca ficar exposta no site. Origem por GPS **ou** digitada à mão
  (mesma busca do destino) — as duas continuam funcionando mesmo sem permissão de localização
- Card da rota anotado só com dados reais da plataforma (relatos e pontos de apoio próximos
  ao trajeto, também marcados no mapa) — nunca inventa iluminação ou movimento que o banco não tem
- **Navegação ativa** com GPS real quando a origem é a localização atual: aviso (sem recálculo
  automático) ao sair da rota, detecção de chegada e encerramento manual. Quando a origem foi
  digitada, mostra a rota como prévia em vez de fingir um GPS que não existe — inclui também
  um modo de simulação só para teste (`?simular=1`)

## Ainda não faz parte deste repositório

- Feed da Comunidade, curtidas e perfil completo, incluindo cadastro de contatos de
  emergência (Bloco 3) — o botão SOS da Tela 2 já existe, mas avisa que precisa do Bloco 3
  até essa tela existir

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
│   ├── alertas.html           placeholder (Bloco 3)
│   └── perfil.html            placeholder (Bloco 3)
├── css/
│   ├── variables.css          tokens do design system
│   ├── global.css             reset e base
│   ├── components.css         botões, cards, modais, nav, toasts
│   ├── auth.css               telas de login/cadastro
│   ├── map.css                tela do mapa
│   ├── rotas.css              tela de rotas e navegação ativa
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
│   ├── nav.js                 bottom navigation e notificações
│   ├── ui.js                  toasts, modais, loading, formatação
│   ├── icons.js               ícones SVG (nenhum emoji)
│   ├── placeholder.js         telas dos próximos blocos
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
[GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md) (Etapas 11 e 12).

---

## Banco de dados

| Tabela | Para que serve |
|---|---|
| `profiles` | Dados públicos do usuário. Criada automaticamente por trigger no cadastro |
| `emergency_contacts` | Contatos de emergência (privado, só a dona vê) |
| `reports` | Relatos de segurança com coordenadas, tipo, nível de atenção e status |
| `support_points` | Farmácias, hospitais, comércios 24h, pontos de ônibus |
| `police_stations` | Delegacias, com marcação de DEAM |
| `posts` | Publicações da comunidade (Bloco 3) |
| `post_likes` | Curtidas, com restrição de uma por pessoa por publicação |
| `notifications` | Notificações do sino |
| `route_history` | Histórico de rotas (Bloco 2) |

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

Mapa: © colaboradores do OpenStreetMap. Geocodificação: [Photon](https://photon.komoot.io), da Komoot,
também construído sobre dados do OpenStreetMap. Cálculo de rotas:
[OpenRouteService](https://openrouteservice.org), da HeiGIT. Use todos com moderação — são
serviços públicos gratuitos.
