/* ============================================================
   ROTA SEGURA — database.js
   CRUD de "locais" (relatos) e agrupamento por ponto no mapa:
   cada ponto (local_key) reúne todos os relatos já feitos ali,
   mostra o mais recente como representante e usa a quantidade
   de relatos para o tamanho do marcador (densidade).
   ============================================================ */

import { supabase } from './supabaseClient.js';

/**
 * Gera uma chave estável para identificar "o mesmo local",
 * normalizando nome + bairro (minúsculas, sem acento, sem espaços
 * extras). Relatos com essa mesma chave são tratados como o
 * mesmo ponto no mapa.
 */
export function gerarLocalKey(nome, bairro) {
  const normalizar = (txt) =>
    (txt || '')
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/\s+/g, ' ');
  return `${normalizar(nome)}|${normalizar(bairro)}`;
}

export async function criarLocal({
  nome, bairro, categoria, nivelSeguranca, periodo, descricao,
  latitude, longitude, autorId, autorNome, anonimo
}) {
  const local_key = gerarLocalKey(nome, bairro);

  const { data, error } = await supabase
    .from('locais')
    .insert({
      nome,
      bairro,
      categoria,
      nivel_seguranca: nivelSeguranca,
      periodo,
      descricao,
      latitude,
      longitude,
      local_key,
      anonimo: !!anonimo,
      autor_id: autorId,
      autor_nome: autorNome
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Busca todos os relatos e agrupa por local_key (mesmo ponto no
 * mapa). Cada item retornado tem:
 *  - representante: o relato mais recente daquele ponto (usado
 *    para nome, categoria, nível de segurança e posição do pino)
 *  - relatos: todos os relatos daquele ponto, mais recentes primeiro
 *  - totalRelatos: quantidade de relatos (usado para o tamanho do
 *    marcador — "heatmap visual" por densidade)
 */
export async function buscarPontosAgrupados() {
  const { data, error } = await supabase
    .from('locais')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const porChave = new Map();
  for (const local of data) {
    if (!porChave.has(local.local_key)) porChave.set(local.local_key, []);
    porChave.get(local.local_key).push(local);
  }

  return Array.from(porChave.values()).map((relatos) => ({
    localKey: relatos[0].local_key,
    representante: relatos[0],
    relatos,
    totalRelatos: relatos.length
  }));
}

export function inscreverNovosLocais(callback) {
  return supabase
    .channel('locais-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locais' }, (payload) => callback(payload.new))
    .subscribe();
}
