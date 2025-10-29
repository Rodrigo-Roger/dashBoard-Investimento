const fmtBRL = v => (Number(v)||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const pct = v => `${(v*100).toFixed(2).replace('.',',')}%`;
const parseISO = s => s ? new Date(s + 'T00:00:00') : null;
const DIA_PAGAMENTO = 10;

const structuredClone = (obj) => JSON.parse(JSON.stringify(obj)); 

const baseCfg = {
  fixo: 6000,
  metas: [
    { alvo: 2000000, aliq: 0.002 }, 
    { alvo: 3000000, aliq: 0.003 }, 
    { alvo: 4000000, aliq: 0.003 }, 
  ],
  pleno: 7500000,
  senior: 15000000,
};

const STORAGE_KEY = 'ms-multi-vendedores-2025';

const state = {
  vendedores: [],
  ativo: null,       
  periodo: 'mensal', 
  dataInicio: null, 
  dataFim: null,
  filtroCronograma: null, 
};

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const angelo = {
      id: crypto.randomUUID(),
      nome: 'Angelo',
      nivel: 'Pleno',
      cfg: structuredClone(baseCfg),
      vendas: []
    };
    state.vendedores = [angelo];
    state.ativo = angelo.id;
    state.periodo = 'mensal';
    
    const hoje = new Date();
    state.filtroCronograma = `${hoje.getFullYear()}-${hoje.getMonth()}`; 
    
    state.dataInicio = null;
    state.dataFim = null;
    
    save();
    return;
  }
  try {
    const s = JSON.parse(raw);
    if (!Array.isArray(s.vendedores) || !s.vendedores.length) {
      const angelo = {
        id: crypto.randomUUID(),
        nome: 'Angelo',
        nivel: 'Pleno',
        cfg: structuredClone(baseCfg),
        vendas: []
      };
      state.vendedores = [angelo];
      state.ativo = angelo.id;
      state.periodo = 'mensal';
    } else {
      Object.assign(state, s);
    }
    
    if (!state.filtroCronograma) {
      const hoje = new Date();
      state.filtroCronograma = `${hoje.getFullYear()}-${hoje.getMonth()}`;
    }
    if (state.periodo === 'trimestral') state.periodo = 'mensal';
    if (state.dataInicio === undefined) state.dataInicio = null;
    if (state.dataFim === undefined) state.dataFim = null;
    
  } catch(e) {
    console.error(e);
  }
}

const byId = id => state.vendedores.find(v => v.id === id) || null;

function getScopeFromUI() {
  const sel = document.getElementById('filtro-vendedor');
  return sel?.value || 'todos';
}

function getScopeVendas(scope) {
  if (scope === 'todos') {
    return state.vendedores.flatMap(v => v.vendas.map(x => ({...x, _owner:v.id})));
  }
  const vend = byId(scope);
  return vend ? vend.vendas.map(x => ({...x, _owner: vend.id})) : [];
}

function getPeriodoInterval() {
  const hoje = new Date();
  
  const fimPadrao = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1, 0, 0, 0, 0); 

  if (state.periodo === 'personalizado' && state.dataInicio && state.dataFim) {
    const inicio = parseISO(state.dataInicio);
    const fimPersonalizado = new Date(parseISO(state.dataFim));
    fimPersonalizado.setDate(fimPersonalizado.getDate() + 1);
    
    if(inicio && fimPersonalizado){
      return { inicio, fim: fimPersonalizado };
    }
  } 
  
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
  return { inicio, fim: fimPadrao };
}

function filtrarVendasPorPeriodo(vendas) {
  const { inicio, fim } = getPeriodoInterval();
  if (!inicio || !fim) return vendas; 
  
  // Filtra apenas vendas ATIVAS OU CANCELADAS dentro do período da DATA DA VENDA
  return vendas.filter(v => {
    const d = parseISO(v.data);
    // Vendas canceladas SÃO SEMPRE exibidas na tabela principal. 
    // Vendas ativas são filtradas pelo período.
    if (v.status === 'cancelado') return true; 

    return d && d >= inicio && d <= fim;
  });
}

function totalVendido(vendas) {
  return vendas.reduce((acc, v) => acc + Number(v.valor||0), 0);
}

function aliquotaAplicavel(total, metas) {
  let aliq = 0;
  if (total >= metas[2].alvo) aliq = metas[2].aliq; 
  else if (total >= metas[1].alvo) aliq = metas[1].aliq;
  else if (total >= metas[0].alvo) aliq = metas[0].aliq;
  return aliq;
}

function dataComissaoParcela(venda, i){
  const start = parseISO(venda.data) || new Date();
  const d = new Date(start);
  d.setMonth(d.getMonth() + i);
  d.setDate(DIA_PAGAMENTO);
  return d;
}

function expectedClientePagasAte(venda, refDate){
  const start = parseISO(venda.data) || new Date();
  const vencDia = start.getDate();
  let count = 0;
  for(let k=0; k<venda.parcelas; k++){
    const due = new Date(start);
    due.setMonth(due.getMonth() + k);
    due.setDate(vencDia);
    if(due <= refDate) count++;
  }
  return count;
}

function cronogramaComissaoVenda(venda, comissaoVenda){
  const today = new Date();
  const cancelAt = venda.status === 'cancelado' && venda.cancelamento ? parseISO(venda.cancelamento) : null;
  const pagasCliente = Number(venda.pagas||0);
  const parcelas = [];

  for(let i=1;i<=6;i++){
    const when = dataComissaoParcela(venda, i);
    let status = 'agendado';

    if(cancelAt){
      if(when >= cancelAt){
        // Após o cancelamento, só paga se tiver pagado 5 ou mais parcelas.
        status = (pagasCliente >= 5) ? 'agendado' : 'cancelado';
        // Se já passou a data da comissão e o cliente pagou >= 5, marca como pago
        if (status === 'agendado' && when <= today) status = 'pago'; 
      } else {
        // Antes do cancelamento, verifica o status real (pago, inadimplente ou agendado)
        if(when <= today){
          const esperadas = expectedClientePagasAte(venda, when);
          const inadimplente = (pagasCliente < Math.min(esperadas, venda.parcelas));
          status = (inadimplente && pagasCliente < 5) ? 'inadimplente' : 'pago'; 
        } else {
          status = 'agendado';
        }
      }
    } else {
      // Se não está cancelado, segue a regra normal (baseada na data de hoje e pagasCliente)
      if(when <= today){
        const esperadas = expectedClientePagasAte(venda, when);
        const inadimplente = (pagasCliente < Math.min(esperadas, venda.parcelas));
        
        if(inadimplente && pagasCliente < 5){
          status = 'inadimplente'; 
        } else {
          status = 'pago'; 
        }
      } else {
        status = 'agendado';
      }
    }

    let statusFinal = status;
    // Aplica o status manual (se existir)
    if (venda.cronograma_manual && venda.cronograma_manual[i-1]) {
      statusFinal = venda.cronograma_manual[i-1];
      if (statusFinal === 'suspenso') statusFinal = 'inadimplente';
    }

    parcelas.push({ data: when, status: statusFinal, valor: comissaoVenda/6 });
  }
  return parcelas;
}

function gerarEstornosPosCancelamento(venda, cronograma){
  const estornos = [];
  if(venda.status !== 'cancelado' || !venda.cancelamento) return estornos;

  const pagasCliente = Number(venda.pagas||0);
  if(pagasCliente >= 5) return estornos;

  const cancelAt = parseISO(venda.cancelamento);
  // Pega as parcelas que foram PAGAS ao vendedor ANTES da data de cancelamento
  const pagasAntes = cronograma.filter(p => p.status === 'pago' && p.data < cancelAt);
  
  // Se o vendedor recebeu comissão antes do cancelamento, gera estorno
  if(pagasAntes.length === 0) return estornos;

  // Data do primeiro estorno (próximo dia 10 após o cancelamento)
  const start = new Date(cancelAt);
  if(start.getDate() > DIA_PAGAMENTO){ start.setMonth(start.getMonth()+1); }
  start.setDate(DIA_PAGAMENTO);

  // Gera um estorno para cada parcela de comissão que foi paga (pagasAntes)
  for(let i=0;i<pagasAntes.length;i++){
    const d = new Date(start);
    d.setMonth(d.getMonth()+i);
    estornos.push({ data: d, status: 'estorno', valor: pagasAntes[0].valor, cliente: venda.cliente, dataVenda: venda.data });
  }
  return estornos;
}

function getComissaoPagaCount(vendaVisual) {
    const vendOwner = byId(vendaVisual._owner);
    if (!vendOwner) return 0;
    
    const vendaReal = vendOwner.vendas.find(v => 
        v.cliente === vendaVisual.cliente && 
        v.data === vendaVisual.data && 
        v.valor === vendaVisual.valor
    );

    if (!vendaReal) return 0;

    // A comissão é uma porcentagem do valor total. O valor aqui não importa, apenas o status.
    const comissaoDeReferencia = 1; 

    if (vendaReal.cronograma_manual && Array.isArray(vendaReal.cronograma_manual)) {
        return vendaReal.cronograma_manual.filter(status => status === 'pago').length;
    }

    const cronogramaAuto = cronogramaComissaoVenda(vendaReal, comissaoDeReferencia); 
    return cronogramaAuto.filter(p => p.status === 'pago').length;
}


function handleVendaStatusChange(vendasEscopo, visualIdx, status, cancelamento, novasPagas) {
  const vendaVisual = vendasEscopo[visualIdx];
  if (!vendaVisual) return;

  const vendOwner = byId(vendaVisual._owner);
  if (!vendOwner) return null;
  
  const vendaReal = vendOwner.vendas.find(v => 
    v.cliente === vendaVisual.cliente && 
    v.data === vendaVisual.data && 
    v.valor === vendaVisual.valor
  );
  
  if (!vendaReal) return;

  vendaReal.status = status;
  
  if (status === 'cancelado') {
    vendaReal.cancelamento = null; 
    if (cancelamento) {
        // O 'cancelamento' é a data do cancelamento (ISO)
        vendaReal.cancelamento = cancelamento;
    } else {
        const hoje = new Date();
        vendaReal.cancelamento = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
    }
    
    // O valor 'novasPagas' (número de parcelas que o cliente efetivamente pagou) 
    if (novasPagas !== undefined) {
        vendaReal.pagas = Number(novasPagas);
    }
  } else {
    // Se a venda for reativada (não está cancelada)
    vendaReal.cancelamento = null;
  }

  save();
  calcular(getScopeFromUI());
}


function renderEstornoActions(vendasEscopo) {
  const container = document.getElementById('estorno-actions-container'); 
  if(!container) return;
  container.innerHTML = '';

  // Filtra apenas vendas ATIVAS
  const vendasAtivas = vendasEscopo.filter(v => v.status === 'ativo');

  if (vendasAtivas.length === 0) {
    container.innerHTML = '<p>Nenhuma venda ativa para cancelar neste escopo.</p>';
    return;
  }

  const select = document.createElement('select');
  select.id = 'select-venda-cancelar';
  
  const defaultOpt = document.createElement('option');
  defaultOpt.textContent = 'Selecione a venda a cancelar...';
  defaultOpt.value = '';
  select.appendChild(defaultOpt);

  vendasAtivas.forEach((v, visualIdx) => {
    const uniqueValue = `${v._owner}_${v.cliente}_${v.data}_${v.valor}`;
    
    const opt = document.createElement('option');
    opt.value = uniqueValue;
    
    const nomeVendedor = v._owner ? byId(v._owner)?.nome : 'Todos';

    opt.textContent = `${v.cliente} - ${v.data} - ${fmtBRL(v.valor)} (${nomeVendedor})`;
    select.appendChild(opt);
  });

  const inputPagas = document.createElement('input');
  inputPagas.type = 'number';
  inputPagas.placeholder = 'Nº de comissões pagas'; 
  inputPagas.id = 'input-pagas-cancelamento';
  inputPagas.style.marginRight = '10px';
  inputPagas.min = "0";

  const btn = document.createElement('button');
  btn.textContent = 'Aplicar Cancelamento';
  btn.className = 'btn red';
  btn.disabled = true;

  select.onchange = (e) => {
    btn.disabled = !e.target.value;
    inputPagas.value = '';

    if (e.target.value) {
      const value = e.target.value;
      const [ownerId, cliente, data, valorStr] = value.split('_');
      const valor = Number(valorStr);

      const vendaSelecionada = vendasAtivas.find(v => 
          v._owner === ownerId && 
          v.cliente === cliente && 
          v.data === data && 
          Number(v.valor) === valor
      );

      // --- Ponto de recuperação das parcelas pagas (do cronograma) ---
      if (vendaSelecionada) {
          inputPagas.value = getComissaoPagaCount(vendaSelecionada); 
      }
      // ----------------------------------------------
    }
  };

  btn.onclick = () => {
    const value = select.value;
    if (!value) return;

    const [ownerId, cliente, data, valorStr] = value.split('_');
    const valor = Number(valorStr);
    
    const vendaVisual = vendasEscopo.find(v => 
        v._owner === ownerId && 
        v.cliente === cliente && 
        v.data === data && 
        Number(v.valor) === valor
    );

    if (!vendaVisual) return;
    
    // Procura o índice no array completo do escopo
    const realVisualIdx = vendasEscopo.findIndex(v => 
        v._owner === ownerId && 
        v.cliente === cliente && 
        v.data === data && 
        Number(v.valor) === valor
    );
    
    if (realVisualIdx === -1) return;

    // Pega o número de parcelas PAGA PELO CLIENTE 
    const numPagas = Number(inputPagas.value) || 0; 
    
    const motivo = prompt(`Confirmar cancelamento da venda de ${vendaVisual.cliente}?\n\nInforme a DATA DE CANCELAMENTO (formato YYYY-MM-DD):`);
    
    if (motivo !== null) {
        if (!motivo || !motivo.match(/^\d{4}-\d{2}-\d{2}$/)) {
            alert('Formato de data inválido. Use YYYY-MM-DD. O cancelamento será registrado com a data de hoje.');
            handleVendaStatusChange(vendasEscopo, realVisualIdx, 'cancelado', null, numPagas);
        } else {
            handleVendaStatusChange(vendasEscopo, realVisualIdx, 'cancelado', motivo, numPagas);
        }
    }
  };

  const estornoDiv = document.createElement('div');
  estornoDiv.style.display = 'flex';
  estornoDiv.style.alignItems = 'center';
  estornoDiv.style.gap = '10px';

  estornoDiv.appendChild(select);
  estornoDiv.appendChild(inputPagas);
  estornoDiv.appendChild(btn);
  container.appendChild(estornoDiv);
}

function generateMonthOptions() {
  const sel = document.getElementById('filtro-cronograma');
  if (!sel) return;

  sel.innerHTML = '';
  
  const hoje = new Date();
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();
  
  for (let i = -12; i <= 12; i++) { 
    const d = new Date(anoAtual, mesAtual + i, 1);
    const mes = d.getMonth();
    const ano = d.getFullYear();
    const value = `${ano}-${mes}`; 
    
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    sel.appendChild(opt);
  }
  
  sel.value = state.filtroCronograma;
  
  sel.onchange = (e) => {
    state.filtroCronograma = e.target.value;
    save();
    calcular(getScopeFromUI());
  };
}

function renderTopDropdowns() {
  const sel = document.getElementById('filtro-vendedor');
  if (!sel) return;
  const current = sel.value || 'todos';
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = 'todos';
  optAll.textContent = 'Todos (geral)';
  sel.appendChild(optAll);

  state.vendedores.forEach(v => {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = `${v.nome} (${v.nivel})`;
    sel.appendChild(o);
  });

  sel.value = current;
  if (!sel.value) sel.value = 'todos';

  const selCfg = document.getElementById('select-vendedor');
  if (selCfg) {
    selCfg.innerHTML = '';
    state.vendedores.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = `${v.nome} (${v.nivel})`;
      selCfg.appendChild(o);
    });
    selCfg.value = state.ativo || (state.vendedores[0]?.id || '');
  }
  
  generateMonthOptions();
}

function renderVendasTable(vendasEscopo) {
  const tbody = document.getElementById('tbody-vendas');
  if(!tbody) return;
  tbody.innerHTML = '';

  // Filtra apenas vendas ATIVAS no período
  const vendasAtivasPeriodo = vendasEscopo.filter(v=>v.status==='ativo');
  // Adiciona todas as vendas CANCELADAS
  const vendasCanceladas = vendasEscopo.filter(v=>v.status==='cancelado');
  // Lista final para exibição
  const vendasParaExibir = [...filtrarVendasPorPeriodo(vendasAtivasPeriodo), ...vendasCanceladas];
  
  vendasParaExibir.forEach((v, idx) => {
    const tr = document.createElement('tr');
    const tag = v.status === 'cancelado' ? `<span class="tag red">CANCELADO ${v.cancelamento ? '('+v.cancelamento+')' : ''}</span>` : '<span class="tag green">Ativo</span>';
    tr.innerHTML = `
      <td>${v.cliente||'-'}</td>
      <td>${v.data||'-'}</td>
      <td><b>${fmtBRL(Number(v.valor||0))}</b></td>
      <td>${tag}</td>
      <td style="text-align:right"><button class="btn gold" data-del="${idx}">Excluir</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-del]').forEach((btn, visualIdx) => {
    btn.addEventListener('click', () => {
      const scope = getScopeFromUI();
      if (scope === 'todos') {
        alert('Troque o filtro para um vendedor específico para excluir vendas.');
        return;
      }
      const vend = byId(scope);
      if (!vend) return;
      
      const vendasAtivasPeriodo = vendasEscopo.filter(v=>v.status==='ativo');
      const vendasCanceladas = vendasEscopo.filter(v=>v.status==='cancelado');
      const vendasVisuais = [...filtrarVendasPorPeriodo(vendasAtivasPeriodo), ...vendasCanceladas];
      
      const vendaVisual = vendasVisuais[visualIdx];
      if (!vendaVisual) return;
      
      const idxReal = vend.vendas.findIndex(x =>
        x.cliente===vendaVisual.cliente &&
        x.data===vendaVisual.data &&
        x.valor===vendaVisual.valor 
      );
      if (idxReal>=0) {
        vend.vendas.splice(idxReal,1);
      }
      save();
      calcular(scope);
    });
  });
}

function renderPagamentosEEstornos(scope, metasRef) {
  const tbPay = document.getElementById('tbody-pagamentos');
  const tbEst = document.getElementById('tbody-estornos');
  const lblEPagos = document.getElementById('pg-pagos');
  const lblEInad = document.getElementById('pg-inadimplentes'); 
  const lblEAgend = document.getElementById('pg-agendados');
  const lblECanc = document.getElementById('pg-cancelados');
  const lblEEst = document.getElementById('pg-estornos');
  const lblELiq = document.getElementById('pg-liquido');
  const lblNext = document.getElementById('pg-proximo');
  const lblEstTotal = document.getElementById('estorno-total');

  if (tbPay) tbPay.innerHTML = '';
  if (tbEst) tbEst.innerHTML = '';

  const [anoFiltro, mesFiltro] = state.filtroCronograma.split('-').map(Number);
  
  const vendasEscopo = getScopeVendas(scope);
  const totalVendasDoEscopo = totalVendido(vendasEscopo.filter(v=>v.status!=='cancelado')); // Total vendido para cálculo da alíquota exclui canceladas
  const aliqDoEscopo = aliquotaAplicavel(totalVendasDoEscopo, metasRef);
  const comissaoTotalDoEscopo = totalVendasDoEscopo * aliqDoEscopo;

  let somaPagos = 0, somaInadimplentes = 0, somaAgendados = 0, somaCancelados = 0, somaEstornos = 0;

  const hoje = new Date(); 
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();

  let comissaoMesKPI = 0; 
  let estornosMesKPI = 0;

  vendasEscopo.forEach((v, vIdx) => {
    let comissaoVenda = 0;
    if (v.status !== 'cancelado') {
        const peso = totalVendasDoEscopo > 0 ? (Number(v.valor || 0) / totalVendasDoEscopo) : 0;
        comissaoVenda = comissaoTotalDoEscopo * peso;
    } else {
        // Para vendas canceladas, usamos uma comissão base para gerar o cronograma
        // e calcular estorno (caso tenha comissão paga antes do cancelamento)
        const comissaoTotalVenda = Number(v.valor || 0) * aliquotaAplicavel(Number(v.valor || 0), metasRef);
        comissaoVenda = comissaoTotalVenda;
    }
    
    const cron = cronogramaComissaoVenda(v, comissaoVenda);
    const est = gerarEstornosPosCancelamento(v, cron);

    cron.forEach(p => {
      const ehMesAtual = p.data.getMonth() === mesAtual && p.data.getFullYear() === anoAtual;
      if (ehMesAtual && (p.status === 'pago' || p.status === 'agendado')) { 
        comissaoMesKPI += p.valor;
      }
    });
    
    est.forEach(ei => {
      const ehMesAtual = ei.data.getMonth() === mesAtual && ei.data.getFullYear() === anoAtual;
      if (ehMesAtual) estornosMesKPI += Math.abs(ei.valor); // CORREÇÃO: usar Math.abs(ei.valor)
    });

    if (tbPay){
      cron.forEach((p, i)=>{
        const ehMesSelecionado = p.data.getMonth() === mesFiltro && p.data.getFullYear() === anoFiltro;

        if (!ehMesSelecionado) {
          return; 
        }

        if(p.status==='pago'){ somaPagos += p.valor; }
        else if(p.status==='inadimplente'){ somaInadimplentes += p.valor; } 
        else if(p.status==='agendado'){ somaAgendados += p.valor; }
        else if(p.status==='cancelado'){ somaCancelados += p.valor; }

        const statusSelect = `
            <select class="status-select" data-venda-idx="${vIdx}" data-parcela-idx="${i}">
                <option value="pago" ${p.status === 'pago' ? 'selected' : ''}>Pago</option>
                <option value="agendado" ${p.status === 'agendado' ? 'selected' : ''}>Agendado</option>
                <option value="inadimplente" ${p.status === 'inadimplente' ? 'selected' : ''}>Inadimplente</option>
                <option value="cancelado" ${p.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select>
        `;
        const tagClass = p.status === 'cancelado' ? 'tag red' : (p.status === 'inadimplente' ? 'tag amber' : '');

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${v.cliente||'-'}</td>
          <td>${p.data.toLocaleDateString('pt-BR', {month:'2-digit', year:'numeric'})}</td>
          <td>${statusSelect}</td> 
          <td class="valor"><b class="${tagClass}">${fmtBRL(p.valor)}</b></td>
        `;
        tbPay.appendChild(tr);
      });
    }

    if (tbEst && est.length){
      est.forEach(ei=>{
        const ehMesSelecionado = ei.data.getMonth() === mesFiltro && ei.data.getFullYear() === anoFiltro;
        
        if (!ehMesSelecionado) return;
        
        somaEstornos += ei.valor;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ei.cliente||v.cliente||'-'}</td>
          <td>${parseISO(v.cancelamento).toLocaleDateString('pt-BR')}</td> 
          <td>${ei.data.toLocaleDateString('pt-BR')}</td> 
          <td>
                <span class="tag red">Estorno</span>
                <span class="tag red" style="margin-left: 5px;">Venda Cancelada</span> 
            </td>
          <td class="valor"><b>-${fmtBRL(ei.valor)}</b></td>
        `;
        tbEst.appendChild(tr);
      });
    }

  });

  const proximo10 = (() => {
    const t = new Date();
    if(t.getDate() > DIA_PAGAMENTO){ t.setMonth(t.getMonth()+1); }
    t.setDate(DIA_PAGAMENTO);
    return t;
  })();

  if(lblEPagos) lblEPagos.textContent = fmtBRL(somaPagos);
  if(lblEInad) lblEInad.textContent = fmtBRL(somaInadimplentes); 
  if(lblEAgend) lblEAgend.textContent = fmtBRL(somaAgendados);
  if(lblECanc) lblECanc.textContent = fmtBRL(somaCancelados);
  if(lblEEst) lblEEst.textContent = fmtBRL(somaEstornos);
  if(lblELiq) lblELiq.textContent = fmtBRL(Math.max(0, somaPagos + somaAgendados - somaEstornos)); 
  if(lblNext) lblNext.textContent = proximo10.toLocaleDateString('pt-BR');
  if(lblEstTotal) lblEstTotal.textContent = fmtBRL(somaEstornos);
  
  document.getElementById('comissao-mes').textContent = fmtBRL(comissaoMesKPI);
  document.getElementById('estornos-mes').textContent = fmtBRL(estornosMesKPI);

  let salarioFixo = 0;
  if (scope === 'todos') salarioFixo = state.vendedores.reduce((acc,v)=>acc+(Number(v.cfg?.fixo)||0),0);
  else salarioFixo = Number(byId(scope)?.cfg?.fixo) || 0;

  const salarioFinal = salarioFixo + comissaoMesKPI - estornosMesKPI;

  document.getElementById('salario-fixo').textContent = fmtBRL(salarioFixo);
  document.getElementById('salario-final').textContent = fmtBRL(salarioFinal);
   
    if (tbPay) {
      tbPay.querySelectorAll('.status-select').forEach(select => {
          select.addEventListener('change', (e) => {
              const novoStatus = e.target.value;
              const parcelaIdx = parseInt(e.target.dataset.parcelaIdx); 
              const visualIdx = parseInt(e.target.dataset.vendaIdx); 
              
              const vendaAfetada = vendasEscopo[visualIdx]; 
              
              if (!vendaAfetada) return;
              
              const vendOwner = byId(vendaAfetada._owner);
              const realIndex = vendOwner.vendas.findIndex(v => v.cliente === vendaAfetada.cliente && v.data === vendaAfetada.data);
              
              if (realIndex >= 0) {
                  const vendaNoState = vendOwner.vendas[realIndex];
                  
                  if (!vendaNoState.cronograma_manual) {
                        // Calcula o cronograma automático para inicializar o manual
                      const cronAuto = cronogramaComissaoVenda(vendaNoState, 1); 
                      vendaNoState.cronograma_manual = cronAuto.map(p => p.status === 'suspenso' ? 'inadimplente' : p.status);
                  }
                  
                  vendaNoState.cronograma_manual[parcelaIdx] = novoStatus;
                  
                  save();
                  calcular(getScopeFromUI());
              }
          });
      });
    }
}

function renderDashboard(scope) {
  const vendasEscopo = getScopeVendas(scope);
  const vendasPeriodo = filtrarVendasPorPeriodo(vendasEscopo); 

  let cfgRef = structuredClone(baseCfg);
  if (scope !== 'todos') {
    const vend = byId(scope);
    if (vend) cfgRef = vend.cfg || structuredClone(baseCfg);
  }

  // KPI de vendas considera apenas vendas ATIVAS
  const total = totalVendido(vendasEscopo.filter(v=>v.status!=='cancelado'));
  const aliq = aliquotaAplicavel(total, cfgRef.metas);
  const comissaoTotal = total * aliq;

  const fixo = (scope==='todos')
    ? state.vendedores.reduce((acc,v)=>acc+(Number(v.cfg?.fixo)||0),0)
    : Number(byId(scope)?.cfg?.fixo) || baseCfg.fixo;

  document.getElementById('kpi-vendas').textContent = fmtBRL(total);
  document.getElementById('kpi-comissao').textContent = fmtBRL(comissaoTotal);
  document.getElementById('kpi-fixo').textContent = fmtBRL(fixo);
  
  let legenda = 'no período atual';
  if (state.periodo === 'mensal') legenda = 'no Mês Atual';
  else if (state.periodo === 'personalizado') legenda = 'no Período Personalizado';
  document.getElementById('kpi-legenda-vendas').textContent = legenda;
  
  document.getElementById('kpi-legenda-comissao').textContent = aliq? `alíquota ${pct(aliq)}`:'sem meta atingida';
  document.getElementById('kpi-legenda-fixo').textContent = scope==='todos' ? 'soma dos fixos' : 'base mensal';

  const metas = cfgRef.metas;
  const bars = ['bar-m1','bar-m2','bar-m3'];
  const tags = ['tag-m1','tag-m2','tag-m3'];
  metas.forEach((m, i) => {
    const perc = m.alvo>0 ? Math.min(100, Math.round((total / m.alvo) * 100)) : 0;
    const bar = document.getElementById(bars[i]);
    const tag = document.getElementById(tags[i]);
    if (bar) bar.style.width = perc + '%';
    if (tag) {
      tag.textContent = perc + '%';
      tag.className = 'tag ' + (perc>=100? 'green': (perc>=50?'amber':'')) || 'tag';
    }
  });

  const ref = total;
  const plenoPerc = cfgRef.pleno>0 ? Math.min(100, Math.round((ref / cfgRef.pleno) * 100)) : 0;
  const seniorPerc = cfgRef.senior>0 ? Math.min(100, Math.round((ref / cfgRef.senior) * 100)) : 0;
  document.getElementById('bar-pleno').style.width = plenoPerc + '%';
  document.getElementById('tag-pleno').textContent = plenoPerc + '%';
  document.getElementById('tag-pleno').className = 'tag ' + (plenoPerc>=100?'green': (plenoPerc>=50?'amber':'')) || 'tag';
  document.getElementById('bar-senior').style.width = seniorPerc + '%';
  document.getElementById('tag-senior').textContent = seniorPerc + '%';
  document.getElementById('tag-senior').className = 'tag ' + (seniorPerc>=100?'green': (seniorPerc>=50?'amber':'')) || 'tag';

  document.getElementById('aliquota').textContent = pct(aliq||0);
  document.getElementById('comissao').textContent = fmtBRL(comissaoTotal);

  const totalFixo = (scope==='todos')
    ? state.vendedores.reduce((acc,v)=>acc+(Number(v.cfg?.fixo)||0),0)
    : Number(byId(scope)?.cfg?.fixo) || 0;
  document.getElementById('total').textContent = fmtBRL(totalFixo + comissaoTotal);

  renderVendasTable(vendasEscopo); 
  renderPagamentosEEstornos(scope, cfgRef.metas);
}

function bindCfgInputsFromActive() {
  const vend = byId(state.ativo);
  const cfg = vend?.cfg || baseCfg;
  const $ = id => document.getElementById(id);

  if ($('cfg-fixo')) $('cfg-fixo').value = cfg.fixo;
  if ($('cfg-m1')) $('cfg-m1').value = cfg.metas[0].alvo;
  if ($('cfg-a1')) $('cfg-a1').value = cfg.metas[0].aliq*100;
  if ($('cfg-m2')) $('cfg-m2').value = cfg.metas[1].alvo;
  if ($('cfg-a2')) $('cfg-a2').value = cfg.metas[1].aliq*100;
  if ($('cfg-m3')) $('cfg-m3').value = cfg.metas[2].alvo;
  if ($('cfg-a3')) $('cfg-a3').value = cfg.metas[2].aliq*100;
  if ($('cfg-pleno')) $('cfg-pleno').value = cfg.pleno;
  if ($('cfg-senior')) $('cfg-senior').value = cfg.senior;

  document.getElementById('salario-fixo').textContent = fmtBRL(cfg.fixo);
  document.getElementById('kpi-fixo').textContent = fmtBRL(cfg.fixo);
}

function saveCfgFromInputs() {
  const vend = byId(state.ativo);
  if (!vend) return;
  const $ = id => Number(document.getElementById(id)?.value || 0);

  vend.cfg.fixo = $('cfg-fixo');
  vend.cfg.metas[0].alvo = $('cfg-m1');
  vend.cfg.metas[0].aliq = $('cfg-a1')/100;
  vend.cfg.metas[1].alvo = $('cfg-m2');
  vend.cfg.metas[1].aliq = $('cfg-a2')/100;
  vend.cfg.metas[2].alvo = $('cfg-m3');
  vend.cfg.metas[2].aliq = $('cfg-a3')/100;
  vend.cfg.pleno = $('cfg-pleno');
  vend.cfg.senior = $('cfg-senior');
  save();
}

function attachUIEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn =>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-view');
      document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
      document.getElementById('view-'+view).style.display = 'block';
    });
  });

  const periodoSelect = document.getElementById('periodo');
  const customRangeDiv = document.getElementById('custom-range');
  
  const updatePeriodoUI = (p) => {
    const dataInicioInput = document.getElementById('data-inicio');
    const dataFimInput = document.getElementById('data-fim');
    
    if (p === 'personalizado') {
      if(customRangeDiv) customRangeDiv.style.display = 'flex';
      if(dataInicioInput) dataInicioInput.value = state.dataInicio || '';
      if(dataFimInput) dataFimInput.value = state.dataFim || '';
    } else {
      if(customRangeDiv) customRangeDiv.style.display = 'none';
    }
  };
  
  if(periodoSelect) periodoSelect.addEventListener('change', (e)=>{
    state.periodo = e.target.value;
    updatePeriodoUI(state.periodo);
    save();
    calcular(getScopeFromUI());
  });
  
  updatePeriodoUI(state.periodo);
  
  const dataInicioInput = document.getElementById('data-inicio');
  const dataFimInput = document.getElementById('data-fim');
  
  const handleDateChange = () => {
    if (dataInicioInput) state.dataInicio = dataInicioInput.value;
    if (dataFimInput) state.dataFim = dataFimInput.value;
    save();
    if (state.periodo === 'personalizado') {
      calcular(getScopeFromUI());
    }
  };
  
  if(dataInicioInput) dataInicioInput.addEventListener('change', handleDateChange);
  if(dataFimInput) dataFimInput.addEventListener('change', handleDateChange);
  
  document.getElementById('filtro-vendedor').addEventListener('change', (e)=>{
    calcular(e.target.value);
  });

  document.getElementById('btn-add').addEventListener('click', ()=>{
    const vend = byId(state.ativo);
    if (!vend) { alert('Nenhum vendedor ativo. Ative um perfil nas Configurações.'); return; }

    const cliente = document.getElementById('cliente').value.trim();
    const valor = Number(document.getElementById('valor').value || 0);
    const data = document.getElementById('data').value || '';

    if(!valor || valor<=0){ alert('Informe um valor válido.'); return; }
    if(!data){ alert('Informe a data da 1ª parcela do cliente.'); return; }

    vend.vendas.push({cliente, valor, data, status: 'ativo', parcelas: 6, pagas: 0});
    save();
    document.getElementById('valor').value = '';
    document.getElementById('cliente').value = '';
    document.getElementById('data').value = '';
    document.getElementById('filtro-vendedor').value = state.ativo;
    calcular(state.ativo);
  });

  document.getElementById('btn-sample').addEventListener('click', ()=>{
    const vend = byId(state.ativo);
    if (!vend) return;
    vend.vendas = [
      {cliente:'Alpha SA', valor: 1200000, data: '2025-09-05', status:'ativo', parcelas: 6, pagas: 1},
      {cliente:'Delta PJ',  valor: 600000,  data: '2025-06-03', status:'ativo', parcelas: 6, pagas: 3},
      {cliente:'Gamma MEI', valor: 300000, data: '2025-07-20', status:'ativo', parcelas: 6, pagas: 0},
    ];
    save();
    document.getElementById('filtro-vendedor').value = state.ativo;
    calcular(state.ativo);
  });

  document.getElementById('btn-limpar').addEventListener('click', ()=>{
    const vend = byId(state.ativo);
    if(!vend) return;
    if(confirm('Remover todas as vendas do vendedor ativo?')){
      vend.vendas = [];
      save(); calcular(getScopeFromUI());
    }
  });

  document.getElementById('btn-salvar').addEventListener('click', ()=>{
    saveCfgFromInputs();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
    alert('Configurações salvas para o vendedor ativo.');
  });

  document.getElementById('btn-resetar').addEventListener('click', ()=>{
    if(!confirm('Voltar aos padrões do vendedor ativo?')) return;
    const vend = byId(state.ativo);
    if (!vend) return;
    vend.cfg = structuredClone(baseCfg);
    save(); bindCfgInputsFromActive(); calcular(getScopeFromUI());
  });

  const btnAddVend = document.getElementById('btn-add-vendedor');
  const btnAtivar = document.getElementById('btn-ativar-vendedor');
  const btnRemover = document.getElementById('btn-remover-vendedor');

  btnAddVend?.addEventListener('click', ()=>{
    const nome = (document.getElementById('novo-vendedor').value || '').trim();
    if(!nome){ alert('Informe o nome do novo vendedor.'); return; }
    const novo = { id: crypto.randomUUID(), nome, nivel:'Pleno', cfg: structuredClone(baseCfg), vendas: [] };
    state.vendedores.push(novo);
    if (!state.ativo) state.ativo = novo.id;
    document.getElementById('novo-vendedor').value = '';
    save();
    renderTopDropdowns();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
    alert(`Vendedor "${nome}" criado.`);
  });

  btnAtivar?.addEventListener('click', ()=>{
    const sel = document.getElementById('select-vendedor');
    if(!sel?.value) return;
    state.ativo = sel.value;
    save();
    document.getElementById('filtro-vendedor').value = state.ativo;
    bindCfgInputsFromActive();
    calcular(state.ativo);
  });

  btnRemover?.addEventListener('click', ()=>{
    const sel = document.getElementById('select-vendedor');
    const id = sel?.value;
    if(!id) return;

    if (state.vendedores.length<=1) { alert('Não é possível excluir. Deve existir pelo menos 1 vendedor.'); return; }
    if (id === state.ativo) { alert('Troque o vendedor ativo antes de removê-lo.'); return; }

    const vend = byId(id);
    const nome = vend?.nome || 'Vendedor';
    state.vendedores = state.vendedores.filter(v => v.id !== id);
    save();
    renderTopDropdowns();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
    alert(`Vendedor "${nome}" removido.`);
  });
}

function calcular(scopeOverride) {
  const scope = scopeOverride || getScopeFromUI();
  renderTopDropdowns();
  const selCfg = document.getElementById('select-vendedor');
  if (selCfg && selCfg.value !== state.ativo) selCfg.value = state.ativo;
  const selPeriodo = document.getElementById('periodo');
  if (selPeriodo) {
    if (state.periodo === 'trimestral') state.periodo = 'mensal';
    if (selPeriodo.value !== state.periodo) selPeriodo.value = state.periodo;
  }
  
  const customRangeDiv = document.getElementById('custom-range');
  if (customRangeDiv) {
    customRangeDiv.style.display = state.periodo === 'personalizado' ? 'flex' : 'none';
  }

  renderDashboard(scope);
  
  // Chama a função para renderizar a ação de estorno/cancelamento
  const vendasEscopo = getScopeVendas(scope);
  renderEstornoActions(vendasEscopo);
}

load();
renderTopDropdowns();
bindCfgInputsFromActive();
attachUIEvents();
const topSel = document.getElementById('filtro-vendedor');
if (topSel) topSel.value = 'todos';
document.getElementById('periodo').value = state.periodo;
calcular('todos');