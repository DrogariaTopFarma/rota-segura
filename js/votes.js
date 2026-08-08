/* ============================================================
   ROTA SEGURA — votes.js
   Validação comunitária de relatos: "Concordo" / "Não concordo".
   Cada usuária vota uma vez por local (pode trocar o voto).
   ============================================================ */

import { supabase } from './supabaseClient.js';

/**
 * Busca todos os votos e devolve um mapa:
 * { [local_id]: { concordo: n, discordo: n, meuVoto: 'concordo'|'discordo'|null } }
 */
export async function buscarResumoVotos(usuarioId) {
  const { data, error } = await supabase.from('locais_votos').select('*');
  if (error) throw error;

  const resumo = {};
  for (const voto of data) {
    if (!resumo[voto.local_id]) resumo[voto.local_id] = { concordo: 0, discordo: 0, meuVoto: null };
    resumo[voto.local_id][voto.voto]++;
    if (voto.usuario_id === usuarioId) resumo[voto.local_id].meuVoto = voto.voto;
  }
  return resumo;
}

/** Registra ou troca o voto da usuária para um local. */
export async function votar({ localId, usuarioId, voto }) {
  const { data, error } = await supabase
    .from('locais_votos')
    .upsert({ local_id: localId, usuario_id: usuarioId, voto }, { onConflict: 'local_id,usuario_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Remove o voto da usuária (clicar de novo no mesmo botão para "desvotar"). */
export async function removerVoto({ localId, usuarioId }) {
  const { error } = await supabase
    .from('locais_votos')
    .delete()
    .eq('local_id', localId)
    .eq('usuario_id', usuarioId);

  if (error) throw error;
}

export function inscreverNovosVotos(callback) {
  return supabase
    .channel('votos-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locais_votos' }, callback)
    .subscribe();
}
