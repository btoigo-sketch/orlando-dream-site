/**
 * precos.js — Motor de preços + cotação Orlando Dream
 * Sem carrinho. Fluxo: ver preço → escolher data → solicitar cotação (WhatsApp ou formulário).
 */

// ── Configuração ──────────────────────────────────────────────────────────────
const CONFIG_KEY    = 'od_config';
// cotacoes.json fica num repositório GitHub separado (btoigo-sketch/orlando-dream-cotacoes),
// atualizado independentemente do deploy do site principal na Netlify.
const COTACAO_FILE  = 'https://raw.githubusercontent.com/btoigo-sketch/orlando-dream-cotacoes/main/cotacoes.json';
const CAL_MAX_MESES = 6;

// Número de WhatsApp da agência (somente dígitos, com DDI)
const WHATSAPP_NUM = '5500000000000';

// Fator de conversão: R$ 15,75 a cada 1.000 milhas Azul
// = R$ 0,01575 por milha/ponto
const DEFAULT_CONFIG = {
  taxa_reais_por_ponto: 0.01575,  // R$ 15,75 / 1.000 pts
  markup_percentual: 0,           // margem aplicada internamente pela agência
};

// ── Catálogo de produtos ───────────────────────────────────────────────────────
const PRODUTOS = [
  // Combos
  { id: 'disney_all',   nome: 'Disney Park Hopper — 4 Parques',      parque: 'disney',    emoji: '✨', pontos_key: 'disney_all',    form_value: 'Disney Park Hopper — 4 Parques'   },
  { id: 'universal_all',nome: 'Universal All Parks — 4 Parques',     parque: 'universal', emoji: '🎢', pontos_key: 'universal_all', form_value: 'Universal All Parks — 4 Parques' },
  // Parques individuais Disney
  { id: 'mk',   nome: 'Magic Kingdom — 1 dia',       parque: 'disney', emoji: '🏰', pontos_key: 'mk',   form_value: 'Magic Kingdom — 1 dia'       },
  { id: 'epcot',nome: 'EPCOT — 1 dia',               parque: 'disney', emoji: '🌍', pontos_key: 'epcot',form_value: 'EPCOT — 1 dia'               },
  { id: 'hs',   nome: 'Hollywood Studios — 1 dia',   parque: 'disney', emoji: '🎬', pontos_key: 'hs',   form_value: 'Hollywood Studios — 1 dia'   },
  { id: 'ak',   nome: 'Animal Kingdom — 1 dia',      parque: 'disney', emoji: '🦁', pontos_key: 'ak',   form_value: 'Animal Kingdom — 1 dia'      },
  // Parques individuais Universal
  { id: 'eu',   nome: 'Epic Universe — 1 dia',             parque: 'universal', emoji: '🚀', pontos_key: 'eu',  form_value: 'Epic Universe — 1 dia'             },
  { id: 'ioa',  nome: 'Islands of Adventure — 1 dia',      parque: 'universal', emoji: '⚡', pontos_key: 'ioa', form_value: 'Islands of Adventure — 1 dia'      },
  { id: 'usf',     nome: 'Universal Studios Florida — 1 dia',  parque: 'universal', emoji: '🎥', pontos_key: 'usf',    form_value: 'Universal Studios Florida — 1 dia'  },
  { id: 'u2park',  nome: 'Universal 2 Parques — Parque a Parque', parque: 'universal', emoji: '🎡', pontos_key: 'u2park', form_value: 'Universal 2 Parques — Parque a Parque' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function formatBRL(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function calcularPreco(pontos, config) {
  const custo = pontos * config.taxa_reais_por_ponto;
  return custo * (1 + config.markup_percentual / 100);
}

function formatarDataBR(dateStr) {
  const [a, m, d] = dateStr.split('-');
  return `${d}/${m}/${a}`;
}

function formatarPrecoMin(valor) {
  return 'R$' + Math.round(valor).toLocaleString('pt-BR');
}

// ── Cotações (cache em memória) ────────────────────────────────────────────────
let _cotacoes    = null;
let _calCotacoes = null;
let _calConfig   = null;

async function getCotacoes() {
  if (_cotacoes) return _cotacoes;
  try {
    const r = await fetch(COTACAO_FILE + '?t=' + Date.now());
    if (!r.ok) throw new Error('not found');
    _cotacoes = await r.json();
  } catch {
    _cotacoes = {
      mk: {pontos_base:24500}, hs: {pontos_base:22000}, epcot: {pontos_base:22000},
      ak: {pontos_base:20000}, disney_all: {pontos_base:65000},
      eu: {pontos_base:28000}, ioa: {pontos_base:21000},
      usf: {pontos_base:21000}, universal_all: {pontos_base:55000},
      u2park: {pontos_base:79314},
    };
  }
  return _cotacoes;
}

function getPrecoById(id, cotacoes, config) {
  const prod = PRODUTOS.find(p => p.id === id);
  if (!prod) return null;
  const cot = cotacoes[prod.pontos_key];
  if (!cot) return null;
  const pontos = parseInt(cot.pontos_base || cot.pontos || 0);
  if (!pontos) return null;
  return { pontos, preco: calcularPreco(pontos, config) };
}

function getPontosParaData(prodId, dateStr) {
  if (!_calCotacoes) return null;
  const prod = PRODUTOS.find(p => p.id === prodId);
  if (!prod) return null;
  const cot = _calCotacoes[prod.pontos_key];
  if (!cot) return null;
  // Usa somente valores reais do cotacoes.json — sem simulação
  if (cot.por_data && cot.por_data[dateStr]) return parseInt(cot.por_data[dateStr]);
  return null;
}

// ── Filtro de tabs ─────────────────────────────────────────────────────────────
function filtrarParque(parque) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.parque === parque || parque === 'todos')
  );
  document.querySelectorAll('.product-card').forEach(card => {
    card.style.display = (parque === 'todos' || card.dataset.parque === parque) ? '' : 'none';
  });
}

// ── Inicialização dos cards ────────────────────────────────────────────────────
async function initIngressos() {
  const cotacoes = await getCotacoes();
  const config   = getConfig();
  _calCotacoes = cotacoes;
  _calConfig   = config;

  PRODUTOS.forEach(prod => {
    const info     = getPrecoById(prod.id, cotacoes, config);
    const elPreco  = document.getElementById('preco-' + prod.id);
    const elPontos = document.getElementById('pontos-' + prod.id);
    const btn      = document.getElementById('btn-' + prod.id);

    if (elPreco) {
      elPreco.textContent = info ? 'a partir de ' + formatBRL(info.preco) : 'Consulte';
    }
    if (elPontos) {
      elPontos.textContent = ''; // pontos internos — não exibir ao usuário
    }
    if (btn) {
      btn.onclick = info
        ? () => abrirCalendario(prod.id)
        : () => document.getElementById('cotacao')?.scrollIntoView({ behavior: 'smooth' });
      btn.disabled = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO DE PREÇOS (agora abre fluxo de cotação, não carrinho)
// ══════════════════════════════════════════════════════════════════════════════

let _calProdId    = null;
let _calDataSel   = null;
let _calAnoMes    = null;
let _calPrimMes   = null;  // { ano, mes } — primeiro mês com dados (navegação mínima)
let _calUltimoMes = null;  // { ano, mes } — último mês com dados reais

/** Classifica tier de temporada pelo valor em reais (referência Disney all) */
function getTemporadaTier(pontos, pontosBase) {
  if (!pontosBase) return 'baixa';
  const mult = pontos / pontosBase;
  if (mult >= 1.25) return 'alta';
  if (mult >= 1.10) return 'media';
  return 'baixa';
}

async function abrirCalendario(prodId) {
  _calProdId  = prodId;
  _calDataSel = null;
  if (!_calCotacoes) _calCotacoes = await getCotacoes();
  if (!_calConfig)   _calConfig   = getConfig();

  const prod = PRODUTOS.find(p => p.id === prodId);
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Encontra primeiro e último mês com dados reais disponíveis (>= hoje)
  const cot = _calCotacoes?.[prod?.pontos_key];
  const datas = cot?.por_data ? Object.keys(cot.por_data).sort() : [];
  const primeiraFutura = datas.find(d => new Date(d + 'T12:00:00') >= hoje);
  const ultimaData     = datas[datas.length - 1];

  if (primeiraFutura) {
    const [a, m] = primeiraFutura.split('-');
    _calAnoMes  = { ano: parseInt(a), mes: parseInt(m) - 1 };
    _calPrimMes = { ano: parseInt(a), mes: parseInt(m) - 1 };
  } else {
    _calAnoMes  = { ano: hoje.getFullYear(), mes: hoje.getMonth() };
    _calPrimMes = { ano: hoje.getFullYear(), mes: hoje.getMonth() };
  }

  if (ultimaData) {
    const [ua, um] = ultimaData.split('-');
    _calUltimoMes = { ano: parseInt(ua), mes: parseInt(um) - 1 };
  } else {
    _calUltimoMes = { ano: _calAnoMes.ano, mes: _calAnoMes.mes + 5 };
  }

  const elEmoji = document.getElementById('cal-emoji');
  const elNome  = document.getElementById('cal-nome');
  if (elEmoji) elEmoji.textContent = prod?.emoji || '🎟️';
  if (elNome)  elNome.textContent  = prod?.nome  || '';

  const modal = document.getElementById('cal-modal');
  if (modal) {
    modal.className = 'cal-modal open ' +
      (prod?.parque === 'disney' ? 'cal-tema-disney' : 'cal-tema-universal');
  }
  document.getElementById('cal-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  renderizarCalendario();
}

function fecharCalendario() {
  document.getElementById('cal-modal')?.classList.remove('open');
  document.getElementById('cal-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function navegarMes(delta) {
  const mesAtual  = _calAnoMes.ano * 12 + _calAnoMes.mes;
  const mesMin    = _calPrimMes ? (_calPrimMes.ano * 12 + _calPrimMes.mes) : mesAtual;
  const mesMax    = _calUltimoMes ? (_calUltimoMes.ano * 12 + _calUltimoMes.mes) : (mesAtual + 5);
  const novoMes   = mesAtual + delta;
  if (novoMes < mesMin || novoMes > mesMax) return;
  _calAnoMes = { ano: Math.floor(novoMes / 12), mes: novoMes % 12 };
  renderizarCalendario();
}

function renderizarCalendario() {
  const { ano, mes } = _calAnoMes;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const maxData = new Date(hoje);
  maxData.setMonth(maxData.getMonth() + CAL_MAX_MESES);

  const label = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const elLabel = document.getElementById('cal-mes-label');
  if (elLabel) elLabel.textContent = label.charAt(0).toUpperCase() + label.slice(1);

  // Botões de navegação — limitados ao range de dados reais
  const mesAtual  = ano * 12 + mes;
  const mesInicio = _calPrimMes ? (_calPrimMes.ano * 12 + _calPrimMes.mes) : mesAtual;
  const mesFim    = _calUltimoMes ? (_calUltimoMes.ano * 12 + _calUltimoMes.mes) : (mesAtual + 5);
  const btnPrev   = document.getElementById('cal-prev-btn');
  const btnNext   = document.getElementById('cal-next-btn');
  if (btnPrev) btnPrev.disabled = (mesAtual <= mesInicio);
  if (btnNext) btnNext.disabled = (mesAtual >= mesFim);

  const chave      = PRODUTOS.find(p => p.id === _calProdId)?.pontos_key;
  const pontosBase = parseInt(_calCotacoes?.[chave]?.pontos_base || _calCotacoes?.[chave]?.pontos || 0);

  const primeiroDia = new Date(ano, mes, 1).getDay();
  const diasNoMes   = new Date(ano, mes + 1, 0).getDate();
  let html = '';
  for (let i = 0; i < primeiroDia; i++) html += '<div class="cal-day vazio"></div>';

  for (let d = 1; d <= diasNoMes; d++) {
    const pad     = n => String(n).padStart(2,'0');
    const dateStr = `${ano}-${pad(mes+1)}-${pad(d)}`;
    const dataDia = new Date(ano, mes, d); dataDia.setHours(0,0,0,0);

    if (dataDia < hoje) {
      html += `<div class="cal-day passado"><span class="cal-day-num">${d}</span></div>`;
      continue;
    }

    const pontosData = getPontosParaData(_calProdId, dateStr);
    const tier = pontosData ? getTemporadaTier(pontosData, pontosBase) : 'sem-preco';
    const preco = pontosData ? calcularPreco(pontosData, _calConfig) : null;
    const sel  = dateStr === _calDataSel ? ' selecionado' : '';

    if (!pontosData) {
      // Dia sem cotação disponível — exibe apagado, não clicável
      html += `<div class="cal-day passado"><span class="cal-day-num" style="opacity:.4">${d}</span></div>`;
    } else {
      html += `<div class="cal-day ${tier}${sel}" onclick="selecionarDataCal('${dateStr}')">
        <span class="cal-day-num">${d}</span>
        <span class="cal-day-preco">${formatarPrecoMin(preco)}</span>
      </div>`;
    }
  }

  const grid = document.getElementById('cal-grid');
  if (grid) grid.innerHTML = html;
  _atualizarFooterCalendario();
}

function selecionarDataCal(dateStr) {
  _calDataSel = dateStr;
  renderizarCalendario();
}

function _atualizarFooterCalendario() {
  const btnCot  = document.getElementById('cal-add-btn');
  const txtData = document.getElementById('cal-sel-date-text');
  const txtPreco = document.getElementById('cal-sel-preco-text');

  if (!_calDataSel) {
    if (txtData)  txtData.textContent  = 'Selecione uma data acima';
    if (txtPreco) txtPreco.textContent = '';
    if (btnCot)   btnCot.disabled = true;
    return;
  }

  const pontosData = getPontosParaData(_calProdId, _calDataSel);
  const preco      = pontosData ? calcularPreco(pontosData, _calConfig) : null;
  if (txtData)  txtData.textContent  = '📅 ' + formatarDataBR(_calDataSel);
  if (txtPreco) txtPreco.textContent = preco ? 'Estimativa de referência: ' + formatBRL(preco) : '';
  if (btnCot)   btnCot.disabled = false;
}

/**
 * Ao confirmar data no calendário:
 * Preenche o formulário de cotação e rola até ele (ou abre WhatsApp diretamente).
 */
function confirmarDataEAdicionar() {
  if (!_calDataSel || !_calProdId) return;
  const prod  = PRODUTOS.find(p => p.id === _calProdId);
  const dataBR = formatarDataBR(_calDataSel);
  fecharCalendario();

  // Preenche o formulário de cotação
  const fParque = document.getElementById('form-parque');
  const fData   = document.getElementById('form-data');
  if (fParque) fParque.value = prod?.form_value || '';
  if (fData)   fData.value  = _calDataSel;

  // Rola até o formulário
  setTimeout(() => {
    document.getElementById('cotacao')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

// ── WhatsApp direto (com ou sem data pré-selecionada) ─────────────────────────
function abrirWhatsApp(parqueNome, dataStr) {
  let msg = `Olá! Gostaria de uma cotação de ingresso para *${parqueNome || 'Orlando'}*`;
  if (dataStr) msg += ` para o dia *${formatarDataBR(dataStr)}*`;
  msg += '.\n\nPoderia me enviar os detalhes e formas de pagamento?';
  const url = `https://wa.me/${WHATSAPP_NUM}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// ── Formulário de cotação ──────────────────────────────────────────────────────
function enviarFormularioCotacao(evt) {
  evt.preventDefault();
  const nome   = document.getElementById('form-nome')?.value.trim();
  const email  = document.getElementById('form-email')?.value.trim();
  const parque = document.getElementById('form-parque')?.value.trim();
  const data   = document.getElementById('form-data')?.value;
  const qtd    = document.getElementById('form-qtd')?.value || '1';
  const obs    = document.getElementById('form-obs')?.value.trim();

  let msg = `Olá! Gostaria de solicitar uma cotação de ingresso.\n\n`;
  msg += `*Nome:* ${nome}\n`;
  msg += `*E-mail:* ${email}\n`;
  if (parque) msg += `*Parque:* ${parque}\n`;
  if (data)   msg += `*Data de visita:* ${formatarDataBR(data)}\n`;
  msg += `*Qtd. visitantes:* ${qtd}\n`;
  if (obs)    msg += `*Observações:* ${obs}\n`;

  const url = `https://wa.me/${WHATSAPP_NUM}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  // Mostra confirmação
  const form = document.getElementById('cotacao-form');
  const conf = document.getElementById('cotacao-confirm');
  if (form) form.style.display = 'none';
  if (conf) conf.style.display = 'block';
}

function novaCotacao() {
  const form = document.getElementById('cotacao-form');
  const conf = document.getElementById('cotacao-confirm');
  if (form) { form.reset(); form.style.display = ''; }
  if (conf) conf.style.display = 'none';
}

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initIngressos();

  // Fecha modal do calendário ao clicar no overlay
  document.getElementById('cal-overlay')?.addEventListener('click', fecharCalendario);

  // Formulário de cotação
  document.getElementById('cotacao-form')?.addEventListener('submit', enviarFormularioCotacao);
});
