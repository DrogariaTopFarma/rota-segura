# Endereços do Rio de Janeiro (CNEFE / Censo 2022 — IBGE)

Estes 9 arquivos CSV contêm **729.954 endereços do Rio de Janeiro** (rua, número,
bairro, CEP e coordenada exata), extraídos do **CNEFE** (Cadastro Nacional de
Endereços para Fins Estatísticos), publicado pelo IBGE a partir do Censo
Demográfico 2022 — a primeira vez que o Censo coletou a coordenada geográfica
de cada endereço, porta a porta.

- Fonte oficial: https://www.ibge.gov.br/estatisticas/sociais/habitacao/38734-cadastro-nacional-de-enderecos-para-fins-estatisticos.html
- Dado público, mantido pelo IBGE (instituto de estatística do governo federal).
- Já filtrado para manter só endereços com coordenada de qualidade "endereço"
  (níveis 1 e 2 do CNEFE — coordenada original ou ajustada do Censo), e reduzido
  a uma linha por endereço físico (o arquivo original do IBGE tem uma linha por
  domicílio/estabelecimento, repetindo o mesmo endereço várias vezes em prédios
  com várias unidades).
- O nome do logradouro já inclui o título/honorífico quando o Censo tem um
  registrado (ex.: "Major Toja Martinez Filho", não só "Toja Martinez Filho").

## ⚠️ Se você já importou uma versão anterior destes arquivos

A primeira versão tinha um bug: o título do logradouro (ex.: "Major", "Coronel",
"Doutor") estava sendo descartado sem querer — afetava quase 600 mil das 3,27
milhões de linhas originais do Rio. Se você já importou, **limpe a tabela antes
de importar de novo**, rodando isto no SQL Editor do Supabase:

```sql
truncate table public.enderecos_rio restart identity;
```

Depois é só seguir os passos normais de importação abaixo com os arquivos
atualizados.

## Como importar no Supabase

1. Rode primeiro o `sql/schema.sql` inteiro (cria a tabela `enderecos_rio` e
   os índices certos, incluindo o índice de busca por trecho do nome).
2. No painel do Supabase, vá em **Table Editor** → selecione a tabela
   **enderecos_rio** → botão **Insert** → **Import data from CSV**.
3. Importe os 9 arquivos, **um de cada vez**, na ordem (01, 02, 03... até 09).
   Cada um tem até 90 mil linhas — o Supabase deve levar só alguns segundos
   por arquivo.
4. As colunas do CSV (`tipo_logradouro, nome_logradouro, numero, bairro, cep,
   lat, lng`) já batem exatamente com as colunas da tabela — não precisa
   mapear nada manualmente, só confirmar o import.

Depois de importados os 9 arquivos, a busca de endereço do app passa a usar
esses dados automaticamente pra endereços do Rio (antes de cair no Photon
pros demais estados) — não precisa mexer em mais nada.

## Sobre a busca

A busca considera o nome do logradouro "contendo" o texto digitado, não só
"começando com" — porque nem toda pessoa vai digitar o título/honorífico da
rua, mesmo quando ele existe no dado do Censo. Se a busca não achar nada com
o texto completo, ela tenta de novo sem a primeira palavra (cobre o caso
contrário: você digitou um título que o Censo não registrou pra aquela rua
especificamente — acontece, o dado do Censo não é 100% uniforme).
