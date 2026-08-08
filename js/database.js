/* ============================================================
   ROTA SEGURA — database.js
   CRUD de "locais" e a lógica de "mostrar só a informação mais
   recente" quando o mesmo lugar foi cadastrado mais de uma vez.
   ============================================================ */

import { supabase } from './supabaseClient.js';

/**
 * Gera uma chave estável para identificar "o mesmo local",
 * normalizando nome + bairro (minúsculas, sem acento, sem espaços
 * extras). Dois cadastros com essa mesma chave são tratados como
 * atualizações do mesmo ponto no mapa.
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

export async function criarLocal({ nome, bairro, categoria, nivelSeguranca, descricao, latitude, longitude, autorId, autorNome }) {
  const local_key = gerarLocalKey(nome, bairro);

  const { data, error } = await supabase
    .from('locais')
    .insert({
      nome,
      bairro,
      categoria,
      nivel_seguranca: nivelSeguranca,
      descricao,
      latitude,
      longitude,
      local_key,
      autor_id: autorId,
      autor_nome: autorNome
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Busca todos os locais e devolve apenas o cadastro MAIS RECENTE
 * de cada local_key. Os demais entram em `desatualizados` — o app
 * pode exibi-los marcados como "informação antiga" em vez de
 * simplesmente escondê-los, se quiser.
 */
export async function buscarLocaisRecentes() {
  const { data, error } = await supabase
    .from('locais')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const vistos = new Set();
  const recentes = [];
  const desatualizados = [];

  for (const local of data) {
    if (vistos.has(local.local_key)) {
      desatualizados.push(local);
    } else {
      vistos.add(local.local_key);
      recentes.push(local);
    }
  }

  return { recentes, desatualizados };
}

export function inscreverNovosLocais(callback) {
  return supabase
    .channel('locais-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locais' }, (payload) => callback(payload.new))
    .subscribe();
}
