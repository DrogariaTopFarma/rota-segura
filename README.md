# Rota Segura — Bloco 1: Fundação

Plataforma colaborativa de segurança para mulheres em deslocamentos urbanos.
Este repositório contém o **Bloco 1**: arquitetura, banco de dados, autenticação e a
**Tela 1 — Mapa de consulta**.

> Começando do zero? Leia o **[GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md)** — ele explica
> cada clique no Supabase, no VS Code e no GitHub.

---

## O que já funciona

- Cadastro, login, logout e recuperação de senha reais (Supabase Auth)
- Proteção de páginas: sem sessão, ninguém entra no mapa
- Mapa Leaflet + OpenStreetMap com localização do usuário e círculo de precisão
- Marcadores SVG diferentes por tipo: relatos, iluminação, pontos de apoio, delegacias, ônibus
- Busca de endereço com geocodificação real (Nominatim), busca em cascata para números de casa
  e priorização pela área visível do mapa
- Seletor de local com mini-mapa e pino arrastável nos formulários, independente da busca da tela
- Precisão do GPS informada em metros, com aviso quando a localização está aproximada
- Contagem de relatos num raio de 500 m do endereço pesquisado
- Cadastro de relato (com upload opcional de imagem) e de ponto de apoio/delegacia, salvando no banco
- Lista "Relatos de segurança" vinda do banco, sem dados fixos no código
- Atualização em tempo real quando um relato novo é criado
- Estados de loading, erro, vazio e permissão negada em todas as funcionalidades
- Row Level Security cobrindo as 9 tabelas

## Ainda não faz parte deste bloco

- Traçado de rota e navegação (Bloco 2)
- Feed da Comunidade, curtidas e perfil completo (Bloco 3)

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
│   ├── rotas.html             placeholder (Bloco 2)
│   ├── alertas.html           placeholder (Bloco 3)
│   └── perfil.html            placeholder (Bloco 3)
├── css/
│   ├── variables.css          tokens do design system
│   ├── global.css             reset e base
│   ├── components.css         botões, cards, modais, nav, toasts
│   ├── auth.css               telas de login/cadastro
│   ├── map.css                tela do mapa
│   └── responsive.css         breakpoints
├── js/
│   ├── config.js              ⚠️ SUAS CHAVES VÃO AQUI
│   ├── supabase.js            cliente e tradução de erros
│   ├── auth.js                login, cadastro, recuperação, logout, guard
│   ├── map.js                 Leaflet, marcadores, consulta por área visível
│   ├── geolocation.js         GPS do navegador
│   ├── geocoding.js           Nominatim (endereço ⇄ coordenadas, cascata de número)
│   ├── location-picker.js     mini-mapa com pino arrastável dos formulários
│   ├── search.js              barra de pesquisa da Tela 1
│   ├── reports.js             lista e formulário de relatos
│   ├── support-points.js      formulário de pontos de apoio e delegacias
│   ├── nav.js                 bottom navigation e notificações
│   ├── ui.js                  toasts, modais, loading, formatação
│   ├── icons.js               ícones SVG (nenhum emoji)
│   ├── placeholder.js         telas dos próximos blocos
│   └── app.js                 ponto de entrada da Tela 1
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

Cada passo está detalhado clique por clique no [GUIA_PASSO_A_PASSO.md](GUIA_PASSO_A_PASSO.md).

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

Mapa e geocodificação: © colaboradores do OpenStreetMap, via Nominatim.
Respeite o limite de 1 requisição por segundo do Nominatim.
