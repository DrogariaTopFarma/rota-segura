/* ============================================================================
   ROTA SEGURA — Voz da navegação (Web Speech API)

   Wrapper fino em cima de `speechSynthesis`, só pra navegação (Tela 2) não
   precisar lidar com nenhum detalhe do navegador diretamente:
   - Se o navegador não suporta (ou está sem voz em português instalada),
     degrada pro silêncio — a navegação continua funcionando 100% visualmente,
     nunca lança erro por causa disso.
   - Preferência de ligado/desligado persiste entre sessões (localStorage) —
     quem desliga uma vez não precisa desligar de novo toda navegação.
   ============================================================================ */

const CHAVE_PREFERENCIA = 'rota-segura:voz-navegacao';
const SUPORTADO = typeof window !== 'undefined' && 'speechSynthesis' in window;

let vozAtiva = SUPORTADO && localStorage.getItem(CHAVE_PREFERENCIA) !== 'desligada';
let vozEscolhida = null;

function escolherVoz() {
  if (!SUPORTADO) return null;
  const vozes = window.speechSynthesis.getVoices();
  // Qualquer voz "pt*" serve (pt-BR, pt-PT) — sem isso, o navegador usa a
  // voz padrão do sistema (geralmente inglês), que lê texto em português
  // com pronúncia estranha.
  return vozes.find((v) => v.lang?.toLowerCase().startsWith('pt')) || null;
}

if (SUPORTADO) {
  // Em vários navegadores a lista de vozes só fica pronta de forma
  // assíncrona, depois do carregamento da página.
  window.speechSynthesis.onvoiceschanged = () => { vozEscolhida = escolherVoz(); };
  vozEscolhida = escolherVoz();
}

export function vozSuportada() { return SUPORTADO; }
export function vozLigada() { return vozAtiva; }

/** Liga/desliga e devolve o novo estado. Desligar corta qualquer fala em
    andamento na hora (não espera terminar a frase). */
export function alternarVoz() {
  vozAtiva = !vozAtiva;
  if (SUPORTADO) localStorage.setItem(CHAVE_PREFERENCIA, vozAtiva ? 'ligada' : 'desligada');
  if (!vozAtiva) window.speechSynthesis.cancel();
  return vozAtiva;
}

/** Fala um texto em português — silenciosamente ignorado se a voz estiver
    desligada, não suportada, ou o texto vier vazio. Nunca lança erro. */
export function falar(texto) {
  if (!SUPORTADO || !vozAtiva || !texto) return;
  try {
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    if (vozEscolhida) fala.voice = vozEscolhida;
    window.speechSynthesis.speak(fala);
  } catch {
    // Nunca deixa um problema de síntese de voz derrubar a navegação.
  }
}

/** Interrompe qualquer fala em andamento sem mexer na preferência ligado/
    desligado — usada ao encerrar a navegação. */
export function pararFala() {
  if (SUPORTADO) window.speechSynthesis.cancel();
}
