const fmtBRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const pct = (v) => `${(v * 100).toFixed(2).replace(".", ",")}%`;
const parseISO = (s) => (s ? new Date(s + "T00:00:00Z") : null);
const DIA_PAGAMENTO = 1;

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

const STORAGE_KEY = "ms-multi-vendedores-2025";

const state = {
  vendedores: [],
  ativo: null,
  periodo: "mensal",
  dataInicio: null,
  dataFim: null,
  filtroCronograma: null,
  dataInicioCronograma: null,
  dataFimCronograma: null,
};

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const angelo = {
      id: crypto.randomUUID(),
      nome: "Angelo",
      nivel: "Pleno",
      cfg: structuredClone(baseCfg),
      vendas: [],
    };
    state.vendedores = [angelo];
    state.ativo = angelo.id;
    state.periodo = "mensal";
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
        nome: "Angelo",
        nivel: "Pleno",
        cfg: structuredClone(baseCfg),
        vendas: [],
      };
      state.vendedores = [angelo];
      state.ativo = angelo.id;
      state.periodo = "mensal";
    } else {
      Object.assign(state, s);
    }
    if (!state.filtroCronograma) {
      const hoje = new Date();
      state.filtroCronograma = `${hoje.getFullYear()}-${hoje.getMonth()}`;
    }
    if (state.periodo === "trimestral") state.periodo = "mensal";
    if (state.dataInicio === undefined) state.dataInicio = null;
    if (state.dataFim === undefined) state.dataFim = null;
  } catch (e) {
    console.error(e);
  }
}

const byId = (id) => state.vendedores.find((v) => v.id === id) || null;

function getScopeFromUI() {
  const sel = document.getElementById("filtro-vendedor");
  return sel?.value || "todos";
}

function getScopeVendas(scope) {
  if (scope === "todos") {
    return state.vendedores.flatMap((v) =>
      v.vendas.map((x) => ({ ...x, _owner: v.id }))
    );
  }
  const vend = byId(scope);
  return vend ? vend.vendas.map((x) => ({ ...x, _owner: vend.id })) : [];
}

function getPeriodoInterval() {
  const hoje = new Date();
  if (state.periodo === "personalizado" && state.dataInicio && state.dataFim) {
    const inicio = parseISO(state.dataInicio);
    const fimPersonalizado = new Date(parseISO(state.dataFim));
    fimPersonalizado.setDate(fimPersonalizado.getDate() + 1);
    if (inicio && fimPersonalizado) {
      return { inicio, fim: fimPersonalizado };
    }
  }
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
  const fimPadrao = new Date(
    hoje.getFullYear(),
    hoje.getMonth() + 1,
    1,
    0,
    0,
    0,
    0
  );
  return { inicio, fim: fimPadrao };
}
function filtrarVendasPorPeriodo(vendas) {
  const { inicio, fim } = getPeriodoInterval();
  if (!inicio || !fim) return vendas;
  return vendas.filter((v) => {
    const d = parseISO(v.data);
    if (v.status === "cancelado") return true;
    return d && d >= inicio && d <= fim;
  });
}

function totalVendido(vendas) {
  return vendas.reduce((acc, v) => acc + Number(v.valor || 0), 0);
}

function aliquotaAplicavel(total, metas) {
  let aliq = 0;
  if (total >= metas[2].alvo) aliq = metas[2].aliq;
  else if (total >= metas[1].alvo) aliq = metas[1].aliq;
  else if (total >= metas[0].alvo) aliq = metas[0].aliq;
  return aliq;
}

function dataComissaoParcela(venda, i) {
  const start = parseISO(venda.data) || new Date();
  const d = new Date(start);
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  d.setDate(DIA_PAGAMENTO);
  return d;
}

function expectedClientePagasAte(venda, refDate) {
  const start = parseISO(venda.data) || new Date();
  const vencDia = start.getDate();
  let count = 0;
  for (let k = 0; k < venda.parcelas; k++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + k);
    due.setDate(vencDia);
    if (due <= refDate) count++;
  }
  return count;
}

function cronogramaComissaoVenda(venda, comissaoVenda) {
  const today = new Date();
  const cancelAt =
    venda.status === "cancelado" && venda.cancelamento
      ? parseISO(venda.cancelamento)
      : null;
  const pagasCliente = Number(venda.pagas || 0);
  const parcelas = [];

  for (let i = 1; i <= 6; i++) {
    let when;
    const parcelaIdx = i - 1;
    const dataRemarcadaStr = venda.datas_remarcadas
      ? venda.datas_remarcadas[parcelaIdx]
      : null;

    if (dataRemarcadaStr) {

      when = parseISO(dataRemarcadaStr);
    } else {

      when = dataComissaoParcela(venda, i);
    }

    let status = "agendado";

    if (cancelAt && pagasCliente < 5) {
      if (when >= cancelAt) {
        status = "cancelado";
      } else {
        const esperadas = expectedClientePagasAte(venda, when);
        const inadimplente = pagasCliente < Math.min(esperadas, venda.parcelas);

        if (when <= today) {
          status = inadimplente ? "inadimplente" : "pago";
        } else {
          status = "agendado";
        }
      }
    } else {
      if (when <= today) {
        const esperadas = expectedClientePagasAte(venda, when);
        const inadimplente = pagasCliente < Math.min(esperadas, venda.parcelas);

        if (inadimplente && pagasCliente < 5) {
          status = "inadimplente";
        } else {
          status = "pago";
        }
      } else {
        status = "agendado";
      }
    }

    let statusFinal = status;
    if (venda.cronograma_manual && venda.cronograma_manual[i - 1]) {
      statusFinal = venda.cronograma_manual[i - 1];
      if (statusFinal === "suspenso") statusFinal = "inadimplente";
    }

    parcelas.push({
      data: when, 
      status: statusFinal,
      valor: comissaoVenda / 6,
    });
  }
  return parcelas;
}

function gerarEstornosPosCancelamento(venda, cronograma) {
  const estornos = [];
  if (venda.status !== "cancelado" || !venda.cancelamento) return estornos;

  const pagasCliente = Number(venda.pagas || 0);
  if (pagasCliente >= 5) return estornos;

  const cancelAt = parseISO(venda.cancelamento);
  const pagasAntes = cronograma.filter(
    (p) => p.status === "pago" && p.data < cancelAt
  );
  if (pagasAntes.length === 0) return estornos;

  const start = new Date(cancelAt);
  if (start.getDate() > DIA_PAGAMENTO) {
    start.setMonth(start.getMonth() + 1);
  }
  start.setDate(DIA_PAGAMENTO);

  for (let i = 0; i < pagasAntes.length; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    estornos.push({
      data: d,
      status: "estorno",
      valor: pagasAntes[i].valor,
      cliente: venda.cliente,
      dataVenda: venda.data,
    });
  }
  return estornos;
}

function getComissaoPagaCount(vendaVisual) {
  const vendOwner = byId(vendaVisual._owner);
  if (!vendOwner) return 0;

  const vendaReal = vendOwner.vendas.find(
    (v) =>
      v.cliente === vendaVisual.cliente &&
      v.data === vendaVisual.data &&
      v.valor === vendaVisual.valor
  );

  if (!vendaReal) return 0;

  const comissaoDeReferencia = 1;

  if (
    vendaReal.cronograma_manual &&
    Array.isArray(vendaReal.cronograma_manual)
  ) {
    return vendaReal.cronograma_manual.filter((status) => status === "pago")
      .length;
  }

  const cronogramaAuto = cronogramaComissaoVenda(
    vendaReal,
    comissaoDeReferencia
  );
  return cronogramaAuto.filter((p) => p.status === "pago").length;
}

function handleVendaStatusChange(
  vendasEscopo,
  visualIdx,
  status,
  cancelamento,
  novasPagas
) {
  const vendaVisual = vendasEscopo[visualIdx];
  if (!vendaVisual) return;

  const vendOwner = byId(vendaVisual._owner);
  if (!vendOwner) return null;
  const vendaReal = vendOwner.vendas.find(
    (v) =>
      v.cliente === vendaVisual.cliente &&
      v.data === vendaVisual.data &&
      v.valor === vendaVisual.valor
  );
  if (!vendaReal) return;

  vendaReal.status = status;
  if (status === "cancelado") {
    vendaReal.cancelamento = null;
    if (cancelamento) {
      vendaReal.cancelamento = cancelamento;
    } else {
      const hoje = new Date();
      vendaReal.cancelamento = `${hoje.getFullYear()}-${String(
        hoje.getMonth() + 1
      ).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    }

    if (novasPagas !== undefined) {
      vendaReal.pagas = Number(novasPagas);
    }
  } else {
    vendaReal.cancelamento = null;
  }

  save();
  calcular(getScopeFromUI());
}

function renderEstornoActions(vendasEscopo) {
  const container = document.getElementById("estorno-actions-container");
  if (!container) return;
  container.innerHTML = "";

  const vendasAtivas = vendasEscopo.filter((v) => v.status === "ativo");

  if (vendasAtivas.length === 0) {
    container.innerHTML =
      "<p>Nenhuma venda ativa para cancelar neste escopo.</p>";
    return;
  }

  const select = document.createElement("select");
  select.id = "select-venda-cancelar";

  const defaultOpt = document.createElement("option");
  defaultOpt.textContent = "Selecione a venda a cancelar...";
  defaultOpt.value = "";
  select.appendChild(defaultOpt);

  vendasAtivas.forEach((v, visualIdx) => {
    const uniqueValue = `${v._owner}_${v.cliente}_${v.data}_${v.valor}`;

    const opt = document.createElement("option");
    opt.value = uniqueValue;

    const nomeVendedor = v._owner ? byId(v._owner)?.nome : "Todos";

    opt.textContent = `${v.cliente} - ${v.data} - ${fmtBRL(
      v.valor
    )} (${nomeVendedor})`;
    select.appendChild(opt);
  });

  const inputPagas = document.createElement("input");
  inputPagas.type = "number";
  inputPagas.placeholder = "Nº de comissões pagas";
  inputPagas.id = "input-pagas-cancelamento";
  inputPagas.style.marginRight = "10px";
  inputPagas.min = "0";

  const btn = document.createElement("button");
  btn.textContent = "Aplicar Cancelamento";
  btn.className = "btn red";
  btn.disabled = true;

  select.onchange = (e) => {
    btn.disabled = !e.target.value;
    inputPagas.value = "";

    if (e.target.value) {
      const value = e.target.value;
      const [ownerId, cliente, data, valorStr] = value.split("_");
      const valor = Number(valorStr);

      const vendaSelecionada = vendasAtivas.find(
        (v) =>
          v._owner === ownerId &&
          v.cliente === cliente &&
          v.data === data &&
          Number(v.valor) === valor
      );

      if (vendaSelecionada) {
        inputPagas.value = getComissaoPagaCount(vendaSelecionada);
      }
    }
  };

  btn.onclick = () => {
    const value = select.value;
    if (!value) return;

    const [ownerId, cliente, data, valorStr] = value.split("_");
    const valor = Number(valorStr);

    const vendaVisual = vendasEscopo.find(
      (v) =>
        v._owner === ownerId &&
        v.cliente === cliente &&
        v.data === data &&
        Number(v.valor) === valor
    );

    if (!vendaVisual) return;
    const realVisualIdx = vendasEscopo.findIndex(
      (v) =>
        v._owner === ownerId &&
        v.cliente === cliente &&
        v.data === data &&
        Number(v.valor) === valor
    );

    if (realVisualIdx === -1) return;

    const numPagas = Number(inputPagas.value) || 0;

    const motivo = prompt(
      `... Informe a DATA DE CANCELAMENTO (formato: DD-MM-AAAA):`
    );

    if (motivo !== null) {
      if (!motivo || !motivo.match(/^\d{2}-\d{2}-\d{4}$/)) {
        alert(
          "Formato de data inválido. Use DD-MM-AAAA (Dia-Mês-Ano). O cancelamento será registrado com a data de hoje."
        );
        handleVendaStatusChange(
          vendasEscopo,
          realVisualIdx,
          "cancelado",
          null,
          numPagas
        );
      } else {
        const [d, m, a] = motivo.split("-");
        const dataISO = `${a}-${m}-${d}`;
        handleVendaStatusChange(
          vendasEscopo,
          realVisualIdx,
          "cancelado",
          dataISO,
          numPagas
        );
      }
    }
  };

  const estornoDiv = document.createElement("div");
  estornoDiv.style.display = "flex";
  estornoDiv.style.alignItems = "center";
  estornoDiv.style.gap = "10px";

  estornoDiv.appendChild(select);
  estornoDiv.appendChild(inputPagas);
  estornoDiv.appendChild(btn);
  container.appendChild(estornoDiv);
}
function showCustomDateInputs(show) {
  const container = document.getElementById("custom-date-fields");
  if (container) {
    container.style.display = show ? "flex" : "none";
  }
}

function generateMonthOptions() {
  const sel = document.getElementById("filtro-cronograma");
  if (!sel) return;

  sel.innerHTML = "";

  const optPersonalizado = document.createElement("option");
  optPersonalizado.value = "personalizado";
  optPersonalizado.textContent = "Período Personalizado...";
  sel.appendChild(optPersonalizado);

  state.filtroCronograma = "personalizado";

  sel.value = state.filtroCronograma;

  sel.onchange = (e) => {
    state.filtroCronograma = e.target.value;
    save();

    showCustomDateInputs(true);
  };

  showCustomDateInputs(true);
}
function getCronogramaInterval() {
  const hoje = new Date();

  if (
    state.filtroCronograma === "personalizado" &&
    state.dataInicioCronograma &&
    state.dataFimCronograma
  ) {
    const inicio = parseISO(state.dataInicioCronograma);
    const fimPersonalizado = new Date(parseISO(state.dataFimCronograma));
    fimPersonalizado.setDate(fimPersonalizado.getDate() + 1);

    if (inicio && fimPersonalizado) {
      return { inicio, fim: fimPersonalizado };
    }
  }
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();

  const inicioPadrao = new Date(ano, mes, 1, 0, 0, 0, 0);
  const fimPadrao = new Date(ano, mes + 1, 1, 0, 0, 0, 0);

  return { inicio: inicioPadrao, fim: fimPadrao };
}
function setupCustomCronogramaEvents() {
  const dataInicioInput = document.getElementById("data-inicio-cronograma");
  const dataFimInput = document.getElementById("data-fim-cronograma");
  const aplicarBtn = document.getElementById("aplicar-filtro-cronograma");

  if (!aplicarBtn || !dataInicioInput || !dataFimInput) {
    console.warn("⚠️ Inputs/botão não encontrados no DOM");
    return;
  }

  aplicarBtn.onclick = () => {
    const dataInicio = dataInicioInput.value;
    const dataFim = dataFimInput.value;

    if (!dataInicio || !dataFim) {
      alert("Por favor, selecione as datas de início e fim.");
      return;
    }
    state.filtroCronograma = "personalizado";
    state.dataInicioCronograma = dataInicio;
    state.dataFimCronograma = dataFim;

    save();
    calcular(getScopeFromUI());
  };

  // Pré-preenche (se houver datas salvas ao carregar)
  if (state.dataInicioCronograma) {
    dataInicioInput.value = state.dataInicioCronograma;
  }
  if (state.dataFimCronograma) {
    dataFimInput.value = state.dataFimCronograma;
  }
}

function renderTopDropdowns() {
  const sel = document.getElementById("filtro-vendedor");
  if (!sel) return;
  const current = sel.value || "todos";
  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "todos";
  optAll.textContent = "Todos (geral)";
  sel.appendChild(optAll);

  state.vendedores.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = `${v.nome} (${v.nivel})`;
    sel.appendChild(o);
  });

  sel.value = current;
  if (!sel.value) sel.value = "todos";

  const selCfg = document.getElementById("select-vendedor");
  if (selCfg) {
    selCfg.innerHTML = "";
    state.vendedores.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = `${v.nome} (${v.nivel})`;
      selCfg.appendChild(o);
    });
    selCfg.value = state.ativo || state.vendedores[0]?.id || "";
  }
  generateMonthOptions();
}

function renderVendasTable(vendasEscopo) {
  const tbody = document.getElementById("tbody-vendas");
  if (!tbody) return;
  tbody.innerHTML = "";

  const vendasAtivasPeriodo = vendasEscopo.filter((v) => v.status === "ativo");
  const vendasCanceladas = vendasEscopo.filter((v) => v.status === "cancelado");
  const vendasParaExibir = [
    ...filtrarVendasPorPeriodo(vendasAtivasPeriodo),
    ...vendasCanceladas,
  ];
  vendasParaExibir.forEach((v, idx) => {
    const tr = document.createElement("tr");
    const tag =
      v.status === "cancelado"
        ? `<span class="tag red">CANCELADO ${
            v.cancelamento ? "(" + v.cancelamento + ")" : ""
          }</span>`
        : '<span class="tag green">Ativo</span>';
    tr.innerHTML = `
      <td>${v.cliente || "-"}</td>
      <td>${v.data || "-"}</td>
      <td><b>${fmtBRL(Number(v.valor || 0))}</b></td>
      <td>${tag}</td>
      <td style="text-align:right"><button class="btn gold" data-del="${idx}">Excluir</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn, visualIdx) => {
    btn.addEventListener("click", () => {
      const scope = getScopeFromUI();
      if (scope === "todos") {
        alert(
          "Troque o filtro para um vendedor específico para excluir vendas."
        );
        return;
      }
      const vend = byId(scope);
      if (!vend) return;
      const vendasAtivasPeriodo = vendasEscopo.filter(
        (v) => v.status === "ativo"
      );
      const vendasCanceladas = vendasEscopo.filter(
        (v) => v.status === "cancelado"
      );
      const vendasVisuais = [
        ...filtrarVendasPorPeriodo(vendasAtivasPeriodo),
        ...vendasCanceladas,
      ];
      const vendaVisual = vendasVisuais[visualIdx];
      if (!vendaVisual) return;
      const idxReal = vend.vendas.findIndex(
        (x) =>
          x.cliente === vendaVisual.cliente &&
          x.data === vendaVisual.data &&
          x.valor === vendaVisual.valor
      );
      if (idxReal >= 0) {
        vend.vendas.splice(idxReal, 1);
      }
      save();
      calcular(scope);
    });
  });
}

function renderPagamentosEEstornos(scope, metasRef) {
  const tbPay = document.getElementById("tbody-pagamentos");
  const tbEst = document.getElementById("tbody-estornos");
  const lblEPagos = document.getElementById("pg-pagos");
  const lblEInad = document.getElementById("pg-inadimplentes");
  const lblEAgend = document.getElementById("pg-agendados");
  const lblECanc = document.getElementById("pg-cancelados");
  const lblEEst = document.getElementById("pg-estornos");
  const lblELiq = document.getElementById("pg-liquido");
  const lblNext = document.getElementById("pg-proximo");
  const lblEstTotal = document.getElementById("estorno-total");

  if (tbPay) tbPay.innerHTML = "";
  if (tbEst) tbEst.innerHTML = "";

  const intervaloCronograma = getCronogramaInterval();
  const vendasEscopo = getScopeVendas(scope);
  
  const ALIQUOTA_BASE_PARA_CRONOGRAMA = metasRef[0].aliq; 

  let somaPagos = 0,
    somaInadimplentes = 0,
    somaAgendados = 0,
    somaCancelados = 0,
    somaEstornos = 0;

  const hoje = new Date();


  const periodoKPI = getPeriodoInterval();
  let comissaoMesKPI = 0;
  let estornosMesKPI = 0;
  
  const vendasPorMes = {};
  
  vendasEscopo.forEach((v) => {
      const dataVenda = parseISO(v.data); 
      if (!dataVenda) return;
      const mesRef = dataVenda.getFullYear() + "-" + (dataVenda.getMonth() + 1).toString().padStart(2, '0');
      
      if (!vendasPorMes[mesRef]) {
          vendasPorMes[mesRef] = 0;
      }

      if (v.status !== "cancelado") {
          vendasPorMes[mesRef] += Number(v.valor || 0);
      }
  });

  const metasBatidasPorMes = {};
  Object.keys(vendasPorMes).forEach(mesRef => {
      const totalVendido = vendasPorMes[mesRef];

      metasBatidasPorMes[mesRef] = aliquotaAplicavel(totalVendido, metasRef);
  });

  vendasEscopo.forEach((v, vIdx) => {
    const dataVenda = parseISO(v.data);
    if (!dataVenda) return;
    
    const mesCriacaoVenda = dataVenda.getFullYear() + "-" + (dataVenda.getMonth() + 1).toString().padStart(2, '0');


    const ALIQUOTA_REAL_VENDA = metasBatidasPorMes[mesCriacaoVenda] || 0;

    let comissaoVenda = Number(v.valor || 0) * ALIQUOTA_REAL_VENDA;
    
    const cron = cronogramaComissaoVenda(v, comissaoVenda);
    const est = gerarEstornosPosCancelamento(v, cron);
    
    cron.forEach((p) => {
      const ehNoPeriodoKPI =
        p.data >= periodoKPI.inicio && p.data <= periodoKPI.fim;

      const metaBatida = ALIQUOTA_REAL_VENDA > 0;
      if (ehNoPeriodoKPI && (p.status === "pago") && metaBatida) {
        comissaoMesKPI += p.valor; 
      }
    });
    
    est.forEach((ei) => {
      const ehNoPeriodoKPI =
        ei.data >= periodoKPI.inicio && ei.data <= periodoKPI.fim;
      if (ehNoPeriodoKPI) estornosMesKPI += Math.abs(ei.valor);
    });

    if (tbPay) {
      cron.forEach((p, i) => {
        const ehNoPeriodoSelecionado =
          p.data >= intervaloCronograma.inicio &&
          p.data < intervaloCronograma.fim;

        if (!ehNoPeriodoSelecionado) {
          return;
        }

        const metaBatida = ALIQUOTA_REAL_VENDA > 0;
        
        let statusParaExibir = p.status;
        let tagClass = '';
        
        if (!metaBatida) {
            statusParaExibir = "Suspenso (Meta não batida)";
            tagClass = "tag red";
        } else {
            if (p.status === "pago") {
                somaPagos += p.valor;
                tagClass = "tag green";
            } else if (p.status === "inadimplente") {
                somaInadimplentes += p.valor;
                tagClass = "tag amber";
            } else if (p.status === "agendado") {
                somaAgendados += p.valor;
                tagClass = ""; 
            } else if (p.status === "cancelado") {
                somaCancelados += p.valor;
                tagClass = "tag red";
            }
        }

        const statusSelect = `
            <select class="status-select" data-venda-idx="${vIdx}" data-parcela-idx="${i}">
                <option value="pago" ${
          p.status === "pago" ? "selected" : ""
        }>Pago</option>
                <option value="agendado" ${
          p.status === "agendado" ? "selected" : ""
        }>Agendado</option>
                <option value="inadimplente" ${
          p.status === "inadimplente" ? "selected" : ""
        }>Inadimplente</option>
                <option value="cancelado" ${
          p.status === "cancelado" ? "selected" : ""
        }>Cancelado</option>
            </select>
        `;
        
        const statusCel = metaBatida ? statusSelect : `<span class="${tagClass}">${statusParaExibir}</span>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${v.cliente || "-"}</td>
          <td>${p.data.toLocaleDateString("pt-BR", {
          month: "2-digit",
          year: "numeric",
        })}</td>
          <td>${statusCel}</td> 
          <td class="valor"><b class="${tagClass}">${fmtBRL(p.valor)}</b></td>
        `;
        tbPay.appendChild(tr);
      });
    }

    if (tbEst && est.length) {
      est.forEach((ei) => {
        const ehNoPeriodoSelecionado =
          ei.data >= intervaloCronograma.inicio &&
          ei.data < intervaloCronograma.fim;
        if (!ehNoPeriodoSelecionado) return;
        somaEstornos += ei.valor;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${ei.cliente || v.cliente || "-"}</td>
          <td>${parseISO(v.cancelamento).toLocaleDateString("pt-BR")}</td> 
          <td>${ei.data.toLocaleDateString("pt-BR")}</td> 
          <td>
                <span class="tag red">Estorno</span>
            </td>
          <td class="valor"><b>-${fmtBRL(ei.valor)}</b></td>
        `;
        tbEst.appendChild(tr);
      });
    }
  });

  const proximo10 = (() => {
    const t = new Date();
    if (t.getDate() > DIA_PAGAMENTO) {
      t.setMonth(t.getMonth() + 1);
    }
    t.setDate(DIA_PAGAMENTO);
    return t;
  })();

  if (lblEPagos) lblEPagos.textContent = fmtBRL(somaPagos);
  if (lblEInad) lblEInad.textContent = fmtBRL(somaInadimplentes);
  if (lblEAgend) lblEAgend.textContent = fmtBRL(somaAgendados);
  if (lblECanc) lblECanc.textContent = fmtBRL(somaCancelados);
  if (lblEEst) lblEEst.textContent = fmtBRL(somaEstornos);
  if (lblELiq)
    lblELiq.textContent = fmtBRL(
      Math.max(0, somaPagos + somaAgendados - somaEstornos)
    );
  if (lblNext) lblNext.textContent = proximo10.toLocaleDateString("pt-BR");
  if (lblEstTotal) lblEstTotal.textContent = fmtBRL(somaEstornos);
  document.getElementById("comissao-mes").textContent = fmtBRL(comissaoMesKPI); 
  document.getElementById("estornos-mes").textContent = fmtBRL(estornosMesKPI);

  let salarioFixo = 0;
  if (scope === "todos")
    salarioFixo = state.vendedores.reduce(
      (acc, v) => acc + (Number(v.cfg?.fixo) || 0),
      0
    );
  else salarioFixo = Number(byId(scope)?.cfg?.fixo) || 0;

  const salarioFinal = salarioFixo + comissaoMesKPI - estornosMesKPI;

  document.getElementById("salario-fixo").textContent = fmtBRL(salarioFixo);
  document.getElementById("salario-final").textContent = fmtBRL(salarioFinal);
  
  if (tbPay) {
    tbPay.querySelectorAll(".status-select").forEach((select) => {
      select.addEventListener("change", (e) => {
        const novoStatus = e.target.value;
        const parcelaIdx = parseInt(e.target.dataset.parcelaIdx);
        const visualIdx = parseInt(e.target.dataset.vendaIdx);
        const vendaAfetada = vendasEscopo[visualIdx];
        if (!vendaAfetada) return;
        const vendOwner = byId(vendaAfetada._owner);
        const realIndex = vendOwner.vendas.findIndex(
          (v) =>
            v.cliente === vendaAfetada.cliente && v.data === vendaAfetada.data
        );
        if (realIndex >= 0) {
          const vendaNoState = vendOwner.vendas[realIndex];
          if (!vendaNoState.cronograma_manual) {
            const cronAuto = cronogramaComissaoVenda(vendaNoState, 1);
            vendaNoState.cronograma_manual = cronAuto.map((p) =>
              p.status === "suspenso" ? "inadimplente" : p.status
            );
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
  if (scope !== "todos") {
    const vend = byId(scope);
    if (vend) cfgRef = vend.cfg || structuredClone(baseCfg);
  }

  const total = totalVendido(
    vendasPeriodo.filter((v) => v.status !== "cancelado")
  );
  
  const aliq = aliquotaAplicavel(total, cfgRef.metas);
  const comissaoTotal = total * aliq;

  const fixo =
    scope === "todos"
      ? state.vendedores.reduce((acc, v) => acc + (Number(v.cfg?.fixo) || 0), 0)
      : Number(byId(scope)?.cfg?.fixo) || baseCfg.fixo;
  document.getElementById("kpi-vendas").textContent = fmtBRL(total);
  document.getElementById("kpi-comissao").textContent = fmtBRL(comissaoTotal);
  document.getElementById("kpi-fixo").textContent = fmtBRL(fixo);
  let legenda = "no período atual";
  if (state.periodo === "mensal") legenda = "no Mês Atual";
  else if (state.periodo === "personalizado")
    legenda = "no Período Personalizado";
  document.getElementById("kpi-legenda-vendas").textContent = legenda;
  document.getElementById("kpi-legenda-comissao").textContent = aliq
    ? `alíquota ${pct(aliq)}`
    : "sem meta atingida";
  document.getElementById("kpi-legenda-fixo").textContent =
    scope === "todos" ? "soma dos fixos" : "base mensal";

  const metas = cfgRef.metas;
  const bars = ["bar-m1", "bar-m2", "bar-m3"];
  const tags = ["tag-m1", "tag-m2", "tag-m3"];
  metas.forEach((m, i) => {
    const perc =
      m.alvo > 0 ? Math.min(100, Math.round((total / m.alvo) * 100)) : 0;
    const bar = document.getElementById(bars[i]);
    const tag = document.getElementById(tags[i]);
    if (bar) bar.style.width = perc + "%";
    if (tag) {
      tag.textContent = perc + "%";
      tag.className =
        "tag " + (perc >= 100 ? "green" : perc >= 50 ? "amber" : "") || "tag";
    }
  });

  const ref = total;
  const plenoPerc =
    cfgRef.pleno > 0
      ? Math.min(100, Math.round((ref / cfgRef.pleno) * 100))
      : 0;
  const seniorPerc =
    cfgRef.senior > 0
      ? Math.min(100, Math.round((ref / cfgRef.senior) * 100))
      : 0;
  document.getElementById("bar-pleno").style.width = plenoPerc + "%";
  document.getElementById("tag-pleno").textContent = plenoPerc + "%";
  document.getElementById("tag-pleno").className =
    "tag " + (plenoPerc >= 100 ? "green" : plenoPerc >= 50 ? "amber" : "") ||
    "tag";
  document.getElementById("bar-senior").style.width = seniorPerc + "%";
  document.getElementById("tag-senior").textContent = seniorPerc + "%";
  document.getElementById("tag-senior").className =
    "tag " + (seniorPerc >= 100 ? "green" : seniorPerc >= 50 ? "amber" : "") ||
    "tag";

  document.getElementById("aliquota").textContent = pct(aliq || 0);
  document.getElementById("comissao").textContent = fmtBRL(comissaoTotal);

  const totalFixo =
    scope === "todos"
      ? state.vendedores.reduce((acc, v) => acc + (Number(v.cfg?.fixo) || 0), 0)
      : Number(byId(scope)?.cfg?.fixo) || 0;
  document.getElementById("total").textContent = fmtBRL(
    totalFixo + comissaoTotal
  );

  renderVendasTable(vendasEscopo);
  renderPagamentosEEstornos(scope, cfgRef.metas);
}

function bindCfgInputsFromActive() {
  const vend = byId(state.ativo);
  const cfg = vend?.cfg || baseCfg;
  const $ = (id) => document.getElementById(id);

  if ($("cfg-fixo")) $("cfg-fixo").value = cfg.fixo;
  if ($("cfg-m1")) $("cfg-m1").value = cfg.metas[0].alvo;
  if ($("cfg-a1")) $("cfg-a1").value = cfg.metas[0].aliq * 100;
  if ($("cfg-m2")) $("cfg-m2").value = cfg.metas[1].alvo;
  if ($("cfg-a2")) $("cfg-a2").value = cfg.metas[1].aliq * 100;
  if ($("cfg-m3")) $("cfg-m3").value = cfg.metas[2].alvo;
  if ($("cfg-a3")) $("cfg-a3").value = cfg.metas[2].aliq * 100;
  if ($("cfg-pleno")) $("cfg-pleno").value = cfg.pleno;
  if ($("cfg-senior")) $("cfg-senior").value = cfg.senior;

  document.getElementById("salario-fixo").textContent = fmtBRL(cfg.fixo);
  document.getElementById("kpi-fixo").textContent = fmtBRL(cfg.fixo);
}

function saveCfgFromInputs() {
  const vend = byId(state.ativo);
  if (!vend) return;
  const $ = (id) => Number(document.getElementById(id)?.value || 0);

  vend.cfg.fixo = $("cfg-fixo");
  vend.cfg.metas[0].alvo = $("cfg-m1");
  vend.cfg.metas[0].aliq = $("cfg-a1") / 100;
  vend.cfg.metas[1].alvo = $("cfg-m2");
  vend.cfg.metas[1].aliq = $("cfg-a2") / 100;
  vend.cfg.metas[2].alvo = $("cfg-m3");
  vend.cfg.metas[2].aliq = $("cfg-a3") / 100;
  vend.cfg.pleno = $("cfg-pleno");
  vend.cfg.senior = $("cfg-senior");
  save();
}

function getClientesInadimplentes() {
  const inadimplentes = [];
  const hoje = new Date();

  state.vendedores.forEach((vendedor) => {
    vendedor.vendas.forEach((venda) => {
      if (venda.status === "cancelado") return;

      const cronograma = cronogramaComissaoVenda(venda, 1);

      const parcelasAtrasadas = cronograma.filter(
        (p) => p.status === "inadimplente" && p.data < hoje
      );

      if (parcelasAtrasadas.length > 0) {
        inadimplentes.push({
          idVenda: venda.id,
          idVendedor: vendedor.id,
          nomeVendedor: vendedor.nome,
          cliente: venda.cliente,
          parcelas: parcelasAtrasadas,
        });
      }
    });
  });
  return inadimplentes;
}

function setupInadimplenciaView() {
  const selectInadimplente = document.getElementById("select-inadimplente");
  const dataRecuperacaoInput = document.getElementById("data-recuperacao");
  const btnRemarcar = document.getElementById("btn-remarcar-pagamentos");
  const camposRecuperacao = document.getElementById("recuperacao-campos");
  const infoInadimplencia = document.getElementById("info-inadimplencia");

  if (!selectInadimplente || !btnRemarcar) return;

  function carregarClientesInadimplentes() {
    const inadimplentes = getClientesInadimplentes();
    selectInadimplente.innerHTML =
      '<option value="">Selecione a venda...</option>';

    inadimplentes.forEach((vendaInadimplente) => {
      const opt = document.createElement("option");
      opt.value = vendaInadimplente.idVenda;
      opt.textContent = `${vendaInadimplente.cliente} (${vendaInadimplente.parcelas.length} parcelas atrasadas) - Vendedor: ${vendaInadimplente.nomeVendedor}`;
      selectInadimplente.appendChild(opt);
    });

    if (inadimplentes.length === 0) {
      infoInadimplencia.textContent =
        "✅ Nenhum cliente inadimplente no momento.";
      camposRecuperacao.style.display = "none";
    } else {
      infoInadimplencia.textContent = `🚨 ${inadimplentes.length} venda(s) com pagamentos pendentes!`;
    }
  }

  selectInadimplente.onchange = () => {
    const vendaId = selectInadimplente.value;
    if (vendaId) {
      camposRecuperacao.style.display = "flex";
    } else {
      camposRecuperacao.style.display = "none";
    }
  };

  btnRemarcar.onclick = () => {
    const vendaId = selectInadimplente.value;
    const dataVolta = dataRecuperacaoInput.value;

    if (!vendaId || !dataVolta) {
      alert("Selecione o cliente e a data de retorno ao pagamento.");
      return;
    }

    remarcarPagamentos(vendaId, dataVolta);
    alert("Pagamentos remarcados com sucesso!");
    carregarClientesInadimplentes();
    camposRecuperacao.style.display = "none";
    dataRecuperacaoInput.value = "";

    calcular(getScopeFromUI());
  };

  carregarClientesInadimplentes();
}

function remarcarPagamentos(vendaId, dataVoltaPagamento) {
  let venda;

  for (const v of state.vendedores) {
    const found = v.vendas.find((vend) => vend.id === vendaId);
    if (found) {
      venda = found;
      break;
    }
  }

  if (!venda) {
    console.error(
      "ERRO CRÍTICO: Venda não encontrada no estado. O ID pode estar errado ou faltando."
    );
    return;
  }

  let cronogramaManual = venda.cronograma_manual;
  if (!cronogramaManual) {
    const cronAuto = cronogramaComissaoVenda(venda, 1);
    cronogramaManual = cronAuto.map((p) =>
      p.status === "suspenso" ? "inadimplente" : p.status
    );
  }

  const inadimplentesIndices = cronogramaManual
    .map((status, index) => (status === "inadimplente" ? index : -1))
    .filter((index) => index !== -1);

  if (inadimplentesIndices.length === 0) {
    return;
  }

  if (!venda.datas_remarcadas) {
    venda.datas_remarcadas = {};
  }

  const primeiroIndexAReagendar = inadimplentesIndices[0];

  let dataRemarcacaoBase = new Date(dataVoltaPagamento);
  dataRemarcacaoBase.setDate(DIA_PAGAMENTO);

  const numParcelasTotal = venda.parcelas || 6;
  const numParcelasRestantes = numParcelasTotal - primeiroIndexAReagendar;

  for (let i = 0; i < numParcelasRestantes; i++) {
    const parcelaIndex = primeiroIndexAReagendar + i;

    let novaData = new Date(dataRemarcacaoBase);

    novaData.setMonth(novaData.getMonth() + (i + 1));
    venda.datas_remarcadas[parcelaIndex] = novaData.toISOString().split("T")[0];
    if (cronogramaManual[parcelaIndex] === "inadimplente") {
      cronogramaManual[parcelaIndex] = "agendado";
    }
  }
  venda.cronograma_manual = cronogramaManual;
  save();
  calcular(getScopeFromUI());
}
function attachUIEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.getAttribute("data-view");
      document
        .querySelectorAll(".view")
        .forEach((v) => (v.style.display = "none"));
      document.getElementById("view-" + view).style.display = "block";
      if (view === "inadimplencia") {
        setupInadimplenciaView();
      }
    });
  });

  const periodoSelect = document.getElementById("periodo");
  const customRangeDiv = document.getElementById("custom-range");

  const updatePeriodoUI = (p) => {
    const dataInicioInput = document.getElementById("data-inicio");
    const dataFimInput = document.getElementById("data-fim");
    if (p === "personalizado") {
      if (customRangeDiv) customRangeDiv.style.display = "flex";
      if (dataInicioInput) dataInicioInput.value = state.dataInicio || "";
      if (dataFimInput) dataFimInput.value = state.dataFim || "";
    } else {
      if (customRangeDiv) customRangeDiv.style.display = "none";
    }
  };
  if (periodoSelect)
    periodoSelect.addEventListener("change", (e) => {
      const customRangeDiv = document.getElementById("custom-range");
      if (customRangeDiv) {
        customRangeDiv.style.display =
          e.target.value === "personalizado" ? "flex" : "none";
      }
    });
  updatePeriodoUI(state.periodo);

  const dataInicioInput = document.getElementById("data-inicio");
  const dataFimInput = document.getElementById("data-fim");
  const handleDateChange = () => {
    if (dataInicioInput) state.dataInicio = dataInicioInput.value;
    if (dataFimInput) state.dataFim = dataFimInput.value;

    save();
  };
  if (dataInicioInput)
    dataInicioInput.addEventListener("change", handleDateChange);
  if (dataFimInput) dataFimInput.addEventListener("change", handleDateChange);
  document
    .getElementById("filtro-vendedor")
    .addEventListener("change", (e) => {});
  document.getElementById("btn-buscar-kpi").addEventListener("click", () => {
    const novoVendedorId = document.getElementById("filtro-vendedor").value;
    const novoPeriodo = document.getElementById("periodo").value;

    state.ativo = novoVendedorId;
    state.periodo = novoPeriodo;

    if (state.periodo === "personalizado") {
      state.dataInicio = document.getElementById("data-inicio").value;
      state.dataFim = document.getElementById("data-fim").value;
    }
    save();
    calcular(novoVendedorId);
  });

  setupCustomCronogramaEvents();

  document.getElementById("btn-add").addEventListener("click", () => {
    const vend = byId(state.ativo);
    if (!vend) {
      alert("Nenhum vendedor ativo. Ative um perfil nas Configurações.");
      return;
    }

    const cliente = document.getElementById("cliente").value.trim();
    const valor = Number(document.getElementById("valor").value || 0);
    const data = document.getElementById("data").value || "";

    if (!valor || valor <= 0) {
      alert("Informe um valor válido.");
      return;
    }
    if (!data) {
      alert("Informe a data da 1ª parcela do cliente.");
      return;
    }

    if (!cliente) {
      alert("Informe o nome do cliente.");
      return;
    }

    vend.vendas.push({
      id: crypto.randomUUID(),
      cliente,
      valor,
      data,
      status: "ativo",
      parcelas: 6,
      pagas: 0,
      datas_remarcadas: {},
      cronograma_manual: null,
    });
    save();
    document.getElementById("valor").value = "";
    document.getElementById("cliente").value = "";
    document.getElementById("data").value = "";
    document.getElementById("filtro-vendedor").value = state.ativo;
    calcular(state.ativo);
  });

  document.getElementById("btn-sample").addEventListener("click", () => {
    const vend = byId(state.ativo);
    if (!vend) return;
    vend.vendas = [
      {
        id: crypto.randomUUID(), 
        cliente: "Alpha SA",
        valor: 1200000,
        data: "2025-09-05",
        status: "ativo",
        parcelas: 6,
        pagas: 1,
        datas_remarcadas: {},
        cronograma_manual: null,
      },
      {
        id: crypto.randomUUID(),
        cliente: "Delta PJ",
        valor: 600000,
        data: "2025-06-03",
        status: "ativo",
        parcelas: 6,
        pagas: 3,
        datas_remarcadas: {},
        cronograma_manual: null,
      },
      {
        id: crypto.randomUUID(), 
        cliente: "Gamma MEI",
        valor: 300000,
        data: "2025-07-20",
        status: "ativo",
        parcelas: 6,
        pagas: 0,
        datas_remarcadas: {},
        cronograma_manual: null,
      },
    ];
    save();
    document.getElementById("filtro-vendedor").value = state.ativo;
    calcular(state.ativo);
  });

  document.getElementById("btn-limpar").addEventListener("click", () => {
    const vend = byId(state.ativo);
    if (!vend) return;
    if (confirm("Remover todas as vendas do vendedor ativo?")) {
      vend.vendas = [];
      save();
      calcular(getScopeFromUI());
    }
  });

  document.getElementById("btn-salvar").addEventListener("click", () => {
    saveCfgFromInputs();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
    alert("Configurações salvas para o vendedor ativo.");
  });

  document.getElementById("btn-resetar").addEventListener("click", () => {
    if (!confirm("Voltar aos padrões do vendedor ativo?")) return;
    const vend = byId(state.ativo);
    if (!vend) return;
    vend.cfg = structuredClone(baseCfg);
    save();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
  });

  const btnAddVend = document.getElementById("btn-add-vendedor");
  const btnAtivar = document.getElementById("btn-ativar-vendedor");
  const btnRemover = document.getElementById("btn-remover-vendedor");

  btnAddVend?.addEventListener("click", () => {
    const nome = (document.getElementById("novo-vendedor").value || "").trim();
    if (!nome) {
      alert("Informe o nome do novo vendedor.");
      return;
    }
    const novo = {
      id: crypto.randomUUID(),
      nome,
      nivel: "Pleno",
      cfg: structuredClone(baseCfg),
      vendas: [],
    };
    state.vendedores.push(novo);
    if (!state.ativo) state.ativo = novo.id;
    document.getElementById("novo-vendedor").value = "";
    save();
    renderTopDropdowns();
    bindCfgInputsFromActive();
    calcular(getScopeFromUI());
    alert(`Vendedor "${nome}" criado.`);
  });

  btnAtivar?.addEventListener("click", () => {
    const sel = document.getElementById("select-vendedor");
    if (!sel?.value) return;
    state.ativo = sel.value;
    save();
    document.getElementById("filtro-vendedor").value = state.ativo;
    bindCfgInputsFromActive();
    calcular(state.ativo);
  });

  btnRemover?.addEventListener("click", () => {
    const sel = document.getElementById("select-vendedor");
    const id = sel?.value;
    if (!id) return;

    if (state.vendedores.length <= 1) {
      alert("Não é possível excluir. Deve existir pelo menos 1 vendedor.");
      return;
    }
    if (id === state.ativo) {
      alert("Troque o vendedor ativo antes de removê-lo.");
      return;
    }

    const vend = byId(id);
    const nome = vend?.nome || "Vendedor";
    state.vendedores = state.vendedores.filter((v) => v.id !== id);
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
  const selCfg = document.getElementById("select-vendedor");
  if (selCfg && selCfg.value !== state.ativo) selCfg.value = state.ativo;
  const selPeriodo = document.getElementById("periodo");
  if (selPeriodo) {
    if (state.periodo === "trimestral") state.periodo = "mensal";
    if (selPeriodo.value !== state.periodo) selPeriodo.value = state.periodo;
  }
  const customRangeDiv = document.getElementById("custom-range");
  if (customRangeDiv) {
    customRangeDiv.style.display =
      state.periodo === "personalizado" ? "flex" : "none";
  }

  renderDashboard(scope);
  const vendasEscopo = getScopeVendas(scope);
  renderEstornoActions(vendasEscopo);
}

load();
renderTopDropdowns();
bindCfgInputsFromActive();
attachUIEvents();
const topSel = document.getElementById("filtro-vendedor");
if (topSel) topSel.value = "todos";
document.getElementById("periodo").value = state.periodo;
calcular("todos");
