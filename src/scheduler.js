const cron = require("node-cron");
const config = require("./config");
const realclinic = require("./services/realclinic");
const maischat = require("./services/maischat");
const { formatarCelular, formatarParaRealclinic, extrairDiaMes } = require("./helpers");

// Como o template do WhatsApp já tem a URL base fixa, o parâmetro dinâmico só carrega
// a query string. A ação (confirmar/cancelar) é diferenciada via &action=... e tratada
// em GET /.
function montarUrlParams(action, ag, DataAgendamento) {
  const { Codigo, NomePaciente, NumeroTelefone, NomeProfissional, NomeProcedimento, Horario } = ag;
  const { dia, mes } = extrairDiaMes(DataAgendamento);
  return `?codigo=${Codigo}&celular=${NumeroTelefone}&nome=${encodeURIComponent(NomePaciente)}&data=${dia}/${mes}&horario=${encodeURIComponent(Horario)}&prof=${encodeURIComponent(NomeProfissional)}&proc=${encodeURIComponent(NomeProcedimento || "")}&action=${action}`;
}

// Calcula "hoje + offsetDias" no fuso configurado e devolve no formato ISO usado pela Realclinic.
function calcularDataAlvo(offsetDias) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.scheduler.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDias);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00Z`;
}

async function executarConfirmacoes() {
  const DataAgendamento = calcularDataAlvo(config.scheduler.diasConfirmacao);
  console.log(`[Scheduler] Confirmações para ${DataAgendamento} (D-${config.scheduler.diasConfirmacao})`);

  let agendamentos = [];
  try {
    agendamentos = await realclinic.listarAgendamentosPorData(DataAgendamento);
  } catch (err) {
    console.log("[Scheduler] Erro ao listar agendamentos para confirmação:", err.response?.data || err.message);
    return { enviados: 0, falhas: 0, total: 0 };
  }

  if (agendamentos.length === 0) {
    console.log("[Scheduler] Nenhum agendamento encontrado para confirmação.");
    return { enviados: 0, falhas: 0, total: 0 };
  }

  let enviados = 0;
  let falhas = 0;

  for (const ag of agendamentos) {
    const { NomePaciente, Horario, NomeProfissional, DataAgendamento: DataAg, Codigo, NumeroTelefone } = ag;
    if (!NumeroTelefone) {
      falhas++;
      console.log(`[Scheduler] Confirmação ${Codigo} (${NomePaciente}): sem NumeroTelefone.`);
      continue;
    }
    try {
      const destination = formatarCelular(NumeroTelefone);
      const { dia, mes } = extrairDiaMes(DataAg || DataAgendamento);
      const urlParams = montarUrlParams("confirmar", ag, DataAg || DataAgendamento);
      const urlParamsCancelar = montarUrlParams("cancelar", ag, DataAg || DataAgendamento);

      const resultado = await maischat.enviarConfirmacao(destination, {
        nomePaciente: NomePaciente,
        dia,
        mes,
        horario: Horario,
        nomeProfissional: NomeProfissional,
        urlParams,
        urlParamsCancelar,
      });

      if (resultado?.data?.data?.status === false) {
        falhas++;
        console.log(`[Scheduler] Confirmação ${Codigo} falhou:`, resultado.data.data.message);
      } else {
        enviados++;
      }
    } catch (err) {
      falhas++;
      console.log(`[Scheduler] Erro na confirmação ${Codigo}:`, err.response?.data?.message || err.message);
    }
  }

  console.log(`[Scheduler] Confirmações: ${enviados} enviadas, ${falhas} falhas (de ${agendamentos.length}).`);
  return { enviados, falhas, total: agendamentos.length };
}

async function executarLembretes() {
  const DataAgendamento = calcularDataAlvo(config.scheduler.diasLembrete);
  console.log(`[Scheduler] Lembretes para ${DataAgendamento} (D-${config.scheduler.diasLembrete})`);

  let agendamentos = [];
  try {
    agendamentos = await realclinic.listarAgendamentosPorData(DataAgendamento);
  } catch (err) {
    console.log("[Scheduler] Erro ao listar agendamentos para lembrete:", err.response?.data || err.message);
    return { enviados: 0, falhas: 0, total: 0 };
  }

  // ListagemAgendamentoData não retorna Status; consulta um a um (Status === 4 = confirmado).
  const confirmados = [];
  for (const ag of agendamentos) {
    try {
      const status = await realclinic.buscarStatusAgendamento(ag.NumeroTelefone, ag.Codigo, formatarParaRealclinic);
      if (status === 4) confirmados.push(ag);
    } catch (e) {
      console.log(`[Scheduler] Erro consultando Status do ag ${ag.Codigo}:`, e.message);
    }
  }

  if (confirmados.length === 0) {
    console.log("[Scheduler] Nenhum agendamento confirmado para lembrete.");
    return { enviados: 0, falhas: 0, total: 0 };
  }
  console.log(`[Scheduler] ${confirmados.length}/${agendamentos.length} agendamentos confirmados (Status=4).`);

  let enviados = 0;
  let falhas = 0;

  for (const ag of confirmados) {
    const { NomePaciente, Horario, NomeProfissional, DataAgendamento: DataAg, Codigo, NumeroTelefone } = ag;
    if (!NumeroTelefone) {
      falhas++;
      console.log(`[Scheduler] Lembrete ${Codigo} (${NomePaciente}): sem NumeroTelefone.`);
      continue;
    }
    try {
      const destination = formatarCelular(NumeroTelefone);
      const { dia, mes } = extrairDiaMes(DataAg || DataAgendamento);

      const resultado = await maischat.enviarLembrete(destination, {
        nomePaciente: NomePaciente,
        dataFormatada: `${dia}/${mes}`,
        horario: Horario,
        nomeProfissional: NomeProfissional,
      });

      if (resultado?.data?.data?.status === false) {
        falhas++;
        console.log(`[Scheduler] Lembrete ${Codigo} falhou:`, resultado.data.data.message);
      } else {
        enviados++;
      }
    } catch (err) {
      falhas++;
      console.log(`[Scheduler] Erro no lembrete ${Codigo}:`, err.response?.data?.message || err.message);
    }
  }

  console.log(`[Scheduler] Lembretes: ${enviados} enviados, ${falhas} falhas (de ${confirmados.length} confirmados).`);
  return { enviados, falhas, total: confirmados.length };
}

function iniciar() {
  if (!config.scheduler.enabled) {
    console.log("[Scheduler] Desabilitado (SCHEDULER_ENABLED=false).");
    return;
  }

  if (!cron.validate(config.scheduler.cron)) {
    console.log(`[Scheduler] Expressão cron inválida: "${config.scheduler.cron}". Jobs não foram agendados.`);
    return;
  }

  cron.schedule(
    config.scheduler.cron,
    async () => {
      const inicio = new Date();
      console.log(`\n[Scheduler] ▶ Jobs diários iniciados em ${inicio.toISOString()}`);
      try {
        await executarConfirmacoes();
      } catch (e) {
        console.log("[Scheduler] Erro inesperado nas confirmações:", e.message);
      }
      try {
        await executarLembretes();
      } catch (e) {
        console.log("[Scheduler] Erro inesperado nos lembretes:", e.message);
      }
      console.log(`[Scheduler] ✔ Jobs diários concluídos em ${Date.now() - inicio.getTime()}ms\n`);
    },
    { timezone: config.scheduler.timezone }
  );

  console.log(
    `[Scheduler] Agendado: "${config.scheduler.cron}" (TZ: ${config.scheduler.timezone}) — confirmação D-${config.scheduler.diasConfirmacao}, lembrete D-${config.scheduler.diasLembrete}.`
  );
}

module.exports = { iniciar, executarConfirmacoes, executarLembretes };
