/* ============================================================================
   ROTA SEGURA — Telas dos próximos blocos (Rotas, Alertas, Perfil)
   Aqui só existe a estrutura de navegação. O conteúdo chega nos Blocos 2 e 3.
   ============================================================================ */

import { exigirLogin, iniciarAuth } from './auth.js';
import { aplicarIcones } from './icons.js';
import { prepararModais, toast } from './ui.js';
import { marcarItemAtivo } from './nav.js';

document.addEventListener('DOMContentLoaded', async () => {
  aplicarIcones();
  const usuario = await exigirLogin();
  if (!usuario) return;

  iniciarAuth();
  prepararModais();
  marcarItemAtivo();

  document.getElementById('botao-central')?.addEventListener('click', () => {
    toast('Para cadastrar, volte à tela do Mapa.', 'info');
    window.location.href = 'mapa.html';
  });
});
