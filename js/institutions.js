/* ============================================================
   ROTA SEGURA — institutions.js
   CRUD de instituições fixas no mapa: Delegacias da Mulher (DEAM)
   e Pontos de Apoio da Rede Amiga (farmácias 24h, comércios
   parceiros, postos de saúde etc).
   ============================================================ */

import { supabase } from './supabaseClient.js';

export async function buscarInstituicoes() {
  const { data, error } = await supabase
    .from('instituicoes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function criarInstituicao({ tipo, nome, endereco, telefone, latitude, longitude, autorId }) {
  const { data, error } = await supabase
    .from('instituicoes')
    .insert({ tipo, nome, endereco, telefone, latitude, longitude, autor_id: autorId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function inscreverNovasInstituicoes(callback) {
  return supabase
    .channel('instituicoes-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'instituicoes' }, (payload) => callback(payload.new))
    .subscribe();
}
