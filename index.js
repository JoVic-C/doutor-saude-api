const express = require("express");
const config = require("./src/config");
const realclinic = require("./src/services/realclinic");
const maischat = require("./src/services/maischat");
const { buscarTemplateOrientacao } = require("./src/services/sheets");
const {
  formatarParaRealclinic,
  formatarCelular,
  extrairDiaMes,
  handleError,
  paginaResposta,
} = require("./src/helpers");

const app = express();
app.use(express.json());

// ─── Middleware de Log ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const inicio = Date.now();
  const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) console.log("  Body:", JSON.stringify(req.body));
  if (req.query && Object.keys(req.query).length > 0) console.log("  Query:", JSON.stringify(req.query));
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    console.log(`  Status: ${res.statusCode} | ${Date.now() - inicio}ms | sucesso: ${data?.sucesso ?? "-"}`);
    return originalJson(data);
  };
  next();
});

// ─── Helpers de Rotas ─────────────────────────────────────────────────────────

function montarUrlParams(ag) {
  const { Codigo, NomePaciente, NumeroTelefone, NomeProfissional, NomeProcedimento, Horario, DataAgendamento } = ag;
  const { dia, mes } = extrairDiaMes(DataAgendamento);
  return `?codigo=${Codigo}&celular=${NumeroTelefone}&nome=${encodeURIComponent(NomePaciente)}&data=${dia}/${mes}&horario=${encodeURIComponent(Horario)}&prof=${encodeURIComponent(NomeProfissional)}&proc=${encodeURIComponent(NomeProcedimento || "")}`;
}

// ─── Rotas: básicas ──────────────────────────────────────────────────────────

app.get("/ping", (_, res) => res.json({ pong: true }));
app.get("/health", (_, res) => res.json({ status: "ok" }));

// ─── Rotas: paciente ─────────────────────────────────────────────────────────

/**
 * POST /paciente/celular
 * Body: { "NumeroCelular": "554884077687" }
 */
app.post("/paciente/celular", async (req, res) => {
  const { NumeroCelular } = req.body;
  if (!NumeroCelular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'NumeroCelular' é obrigatório." });
  try {
    const paciente = await realclinic.buscarPacientePorCelular(formatarParaRealclinic(NumeroCelular));
    return res.status(200).json({ sucesso: true, paciente });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /paciente/agendamentos
 * Body: { "NumeroCelular": "554884077687" }
 */
app.post("/paciente/agendamentos", async (req, res) => {
  const { NumeroCelular } = req.body;
  if (!NumeroCelular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'NumeroCelular' é obrigatório." });

  let idPaciente = null;
  try {
    const paciente = await realclinic.buscarPacientePorCelular(formatarParaRealclinic(NumeroCelular));
    idPaciente = paciente?.Id;
  } catch (e) {
    return handleError(e, res);
  }

  if (!idPaciente) return res.status(404).json({ sucesso: false, mensagem: "Paciente não encontrado." });

  try {
    const agendamentos = await realclinic.buscarAgendamentosPaciente(idPaciente);
    if (agendamentos.length === 0) return res.status(404).json({ sucesso: false, mensagem: "Nenhum agendamento encontrado." });

    const ultimo = agendamentos[agendamentos.length - 1];
    return res.status(200).json({
      sucesso: true,
      agendamento: {
        IdAgendamento: ultimo.IdAgendamento,
        Data: ultimo.Data,
        NomeProcedimento: ultimo.NomeProcedimento,
        NomeProfissional: ultimo.NomeProfissional,
        NomeEspecialidade: ultimo.NomeEspecialidade,
        NomeConvenio: ultimo.NomeConvenio,
        NomePlano: ultimo.NomePlano,
        NomeUnidade: ultimo.NomeUnidade,
      },
    });
  } catch (error) {
    return handleError(error, res);
  }
});

// ─── Rotas: agendamento ──────────────────────────────────────────────────────

/**
 * POST /agendamento/enviar-confirmacao
 * Body: { "NumeroCelular": "554884077687" }
 */
app.post("/agendamento/enviar-confirmacao", async (req, res) => {
  const { NumeroCelular } = req.body;
  if (!NumeroCelular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'NumeroCelular' é obrigatório." });

  let idPaciente = null;
  try {
    const paciente = await realclinic.buscarPacientePorCelular(formatarParaRealclinic(NumeroCelular));
    idPaciente = paciente?.Id;
  } catch (e) {
    return handleError(e, res);
  }

  if (!idPaciente) return res.status(404).json({ sucesso: false, mensagem: "Paciente não encontrado." });

  let agendamento = null;
  try {
    const lista = await realclinic.buscarAgendamentosPaciente(idPaciente);
    if (lista.length === 0) return res.status(404).json({ sucesso: false, mensagem: "Nenhum agendamento encontrado." });
    agendamento = lista[lista.length - 1];
  } catch (e) {
    return handleError(e, res);
  }

  const destination     = formatarCelular(NumeroCelular);
  const nomePaciente    = agendamento.NomePaciente || "Paciente";
  const nomeProfissional = agendamento.NomeProfissional || "";
  const nomeProc        = agendamento.NomeProcedimento || "";
  const { dia, mes }    = extrairDiaMes(agendamento.Data);
  const horario         = agendamento.Data
    ? new Date(agendamento.Data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    : "";
  const codigo          = agendamento.IdAgendamento || "";
  const celularDestino  = formatarParaRealclinic(NumeroCelular);

  const urlParams = `?codigo=${codigo}&celular=${celularDestino}&nome=${encodeURIComponent(nomePaciente)}&data=${dia}/${mes}&horario=${encodeURIComponent(horario)}&prof=${encodeURIComponent(nomeProfissional)}&proc=${encodeURIComponent(nomeProc)}`;

  try {
    const response = await maischat.enviarConfirmacao(destination, {
      nomePaciente, dia, mes, horario, nomeProfissional, urlParams,
    });
    return res.status(200).json({
      sucesso: true,
      mensagem: "Template de confirmação enviado!",
      destination,
      paciente: { nomePaciente, nomeProfissional, nomeProc, dia, mes, horario, codigo },
      msgId: response.data?.data?.msgId,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/enviar-confirmacoes
 * Envia template de confirmação em lote para todos os agendamentos de uma data.
 * Body: { "DataAgendamento": "2026-04-17T00:00:00Z" }
 */
app.post("/agendamento/enviar-confirmacoes", async (req, res) => {
  const { DataAgendamento } = req.body;
  if (!DataAgendamento) return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });

  const data = new Date(DataAgendamento);
  if (isNaN(data.getTime())) return res.status(400).json({ sucesso: false, mensagem: "Formato de data inválido." });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  if (data < hoje) return res.status(400).json({ sucesso: false, mensagem: "Não são aceitos horários retroativos." });

  let agendamentos = [];
  try {
    agendamentos = await realclinic.listarAgendamentosPorData(DataAgendamento);
  } catch (error) {
    return handleError(error, res);
  }

  if (agendamentos.length === 0) {
    return res.status(200).json({ sucesso: true, mensagem: "Nenhum agendamento encontrado.", total: 0, totalEnviados: 0, totalFalhas: 0, enviados: [], falhas: [] });
  }

  const enviados = [];
  const falhas = [];

  for (const ag of agendamentos) {
    const { NomePaciente, Horario, NomeProfissional, DataAgendamento: DataAg, Codigo, NumeroTelefone } = ag;
    try {
      if (!NumeroTelefone) { falhas.push({ Codigo, NomePaciente, motivo: "NumeroTelefone não encontrado." }); continue; }

      const destination  = formatarCelular(NumeroTelefone);
      const { dia, mes } = extrairDiaMes(DataAg || DataAgendamento);
      const urlParams    = montarUrlParams({ ...ag, DataAgendamento: DataAg || DataAgendamento });
      const urlParamsCancelar = urlParams;

      const resultado = await maischat.enviarConfirmacao(destination, {
        nomePaciente: NomePaciente,
        dia, mes,
        horario: Horario,
        nomeProfissional: NomeProfissional,
        urlParams,
        urlParamsCancelar,
      });

      if (resultado?.data?.data?.status === false) {
        falhas.push({ Codigo, NomePaciente, motivo: resultado.data.data.message });
      } else {
        enviados.push({ Codigo, NomePaciente, destination, msgId: resultado?.data?.data?.msgId });
      }
    } catch (err) {
      falhas.push({ Codigo, NomePaciente, motivo: err.response?.data?.message || err.message });
    }
  }

  return res.status(200).json({ sucesso: true, total: agendamentos.length, totalEnviados: enviados.length, totalFalhas: falhas.length, enviados, falhas });
});

/**
 * POST /agendamento/enviar-lembretes
 * Envia template de lembrete em lote para todos os agendamentos *confirmados* de uma data.
 * Body: { "DataAgendamento": "2026-04-17T00:00:00Z" }
 */
app.post("/agendamento/enviar-lembretes", async (req, res) => {
  const { DataAgendamento } = req.body;
  if (!DataAgendamento) return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });

  const data = new Date(DataAgendamento);
  if (isNaN(data.getTime())) return res.status(400).json({ sucesso: false, mensagem: "Formato de data inválido." });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  if (data < hoje) return res.status(400).json({ sucesso: false, mensagem: "Não são aceitos horários retroativos." });

  let agendamentos = [];
  try {
    agendamentos = await realclinic.listarAgendamentosPorData(DataAgendamento);
  } catch (error) {
    return handleError(error, res);
  }

  const confirmados = agendamentos.filter(ag => {
    const status = (ag.Situacao || ag.Status || "").toString().toLowerCase();
    return status.includes("confirmad");
  });

  if (confirmados.length === 0) {
    return res.status(200).json({ sucesso: true, mensagem: "Nenhum agendamento confirmado encontrado.", total: 0, totalEnviados: 0, totalFalhas: 0, enviados: [], falhas: [] });
  }

  const enviados = [];
  const falhas = [];

  for (const ag of confirmados) {
    const { NomePaciente, Horario, NomeProfissional, DataAgendamento: DataAg, Codigo, NumeroTelefone } = ag;
    try {
      if (!NumeroTelefone) { falhas.push({ Codigo, NomePaciente, motivo: "NumeroTelefone não encontrado." }); continue; }

      const destination = formatarCelular(NumeroTelefone);
      const { dia, mes } = extrairDiaMes(DataAg || DataAgendamento);

      const resultado = await maischat.enviarLembrete(destination, {
        nomePaciente: NomePaciente,
        dataFormatada: `${dia}/${mes}`,
        horario: Horario,
        nomeProfissional: NomeProfissional,
      });

      if (resultado?.data?.data?.status === false) {
        falhas.push({ Codigo, NomePaciente, motivo: resultado.data.data.message });
      } else {
        enviados.push({ Codigo, NomePaciente, destination, msgId: resultado?.data?.data?.msgId });
      }
    } catch (err) {
      falhas.push({ Codigo, NomePaciente, motivo: err.response?.data?.message || err.message });
    }
  }

  return res.status(200).json({ sucesso: true, total: confirmados.length, totalEnviados: enviados.length, totalFalhas: falhas.length, enviados, falhas });
});

/**
 * POST /agendamento/listagem-por-data
 * Body: { "DataAgendamento": "2026-04-17T00:00:00Z" }
 */
app.post("/agendamento/listagem-por-data", async (req, res) => {
  const { DataAgendamento } = req.body;
  if (!DataAgendamento) return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });
  const data = new Date(DataAgendamento);
  if (isNaN(data.getTime())) return res.status(400).json({ sucesso: false, mensagem: "Formato de data inválido." });
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  if (data < hoje) return res.status(400).json({ sucesso: false, mensagem: "Não são aceitos horários retroativos." });
  try {
    const agendamentos = await realclinic.listarAgendamentosPorData(DataAgendamento);
    return res.status(200).json({ sucesso: true, agendamentos });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/cancelar-agendamento
 * Body: { "codigo": 398459 }
 */
app.post("/agendamento/cancelar-agendamento", async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ sucesso: false, mensagem: "O campo 'codigo' é obrigatório." });
  try {
    await realclinic.cancelarAgendamento(codigo);
    return res.status(200).json({ sucesso: true, mensagem: "Agendamento cancelado com sucesso!", codigo });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/confirmar-e-orientar
 * Body: { "codigo": 398459, "celular": "48984077687", "proc": "USG..." }
 */
app.post("/agendamento/confirmar-e-orientar", async (req, res) => {
  const { codigo, celular, proc } = req.body;
  if (!codigo) return res.status(400).json({ sucesso: false, mensagem: "O campo 'codigo' é obrigatório." });
  if (!celular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'celular' é obrigatório." });

  try {
    await realclinic.confirmarAgendamento(codigo);
    console.log(`Agendamento ${codigo} confirmado!`);
  } catch (e) {
    console.log("Erro ao confirmar:", e.response?.data || e.message);
  }

  let templateName = null;
  try {
    templateName = await buscarTemplateOrientacao(null, proc);
  } catch (e) {
    console.log("Erro ao buscar template da orientação:", e.message);
  }
  if (!templateName) return res.status(404).json({ sucesso: false, mensagem: "Orientação não encontrada para este procedimento." });

  try {
    const destination = formatarCelular(celular);
    const response = await maischat.enviarOrientacaoTemplate(destination, templateName);
    return res.status(200).json({
      sucesso: true,
      mensagem: "Agendamento confirmado e orientação enviada!",
      destination,
      templateName,
      msgId: response.data?.data?.msgId,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

// ─── Rotas: confirmação/cancelamento via botão (GET) ─────────────────────────

/**
 * GET /confirmar
 * Chamado pelo botão do template. Confirma + envia orientação.
 */
app.get("/confirmar", async (req, res) => {
  const { codigo, celular, proc, nome, horario, prof, data } = req.query;

  if (!codigo || !celular) {
    return res.send(paginaResposta("⚠️", "Dados inválidos", "Link de confirmação inválido. Entre em contato com a clínica.", "#f59e0b"));
  }

  try {
    await realclinic.confirmarAgendamento(codigo);
    console.log(`Agendamento ${codigo} confirmado!`);
  } catch (e) {
    console.log("Erro ao confirmar:", e.response?.data || e.message);
  }

  let templateName = null;
  try {
    templateName = await buscarTemplateOrientacao(null, proc);
  } catch (e) {
    console.log("Erro ao buscar template da orientação:", e.message);
  }

  if (templateName) {
    try {
      const destination = formatarCelular(celular);
      await maischat.enviarOrientacaoTemplate(destination, templateName);
      console.log(`Orientação enviada para ${destination} (template: ${templateName})`);
    } catch (e) {
      console.log("Erro ao enviar orientação:", e.message);
    }
  }

  return res.send(paginaResposta("✅", "Consulta confirmada!", `Olá, ${nome || "paciente"}! Sua consulta do dia <strong>${data || "--"}</strong> às <strong>${horario || "--"}</strong> com <strong>${prof || "--"}</strong> foi confirmada.<br><br>As orientações foram enviadas para o seu WhatsApp.`, "#0a6e4e"));
});

/**
 * GET /cancelar
 * Chamado pelo botão cancelar do template.
 */
app.get("/cancelar", async (req, res) => {
  const { codigo, nome, horario, prof, data } = req.query;
  console.log(`Cancelamento — Código: ${codigo} | Paciente: ${nome}`);

  try {
    await realclinic.cancelarAgendamento(codigo);
    console.log(`Agendamento ${codigo} cancelado!`);
  } catch (e) {
    console.log("Erro ao cancelar:", e.response?.data || e.message);
  }

  return res.send(paginaResposta("❌", "Consulta cancelada.", `Sua consulta do dia <strong>${data || "--"}</strong> às <strong>${horario || "--"}</strong> foi cancelada.<br><br>Entre em contato para reagendar.`, "#c0392b"));
});

// ─── Rotas: orientação ───────────────────────────────────────────────────────

/**
 * POST /orientacao/enviar
 * Envia o template de orientação (sem variáveis) para o paciente.
 * Body: { "celular": "48984077687", "proc": "USG - ABDOME TOTAL" }
 */
app.post("/orientacao/enviar", async (req, res) => {
  const { celular, proc, idProc } = req.body;
  if (!celular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'celular' é obrigatório." });
  if (!proc && !idProc) return res.status(400).json({ sucesso: false, mensagem: "Informe 'proc' ou 'idProc'." });

  let templateName = null;
  try {
    templateName = await buscarTemplateOrientacao(idProc, proc);
  } catch (e) {
    console.log("Erro ao buscar template da orientação:", e.message);
  }

  if (!templateName) return res.status(404).json({ sucesso: false, mensagem: "Orientação não encontrada para este procedimento." });

  try {
    const destination = formatarCelular(celular);
    const response = await maischat.enviarOrientacaoTemplate(destination, templateName);
    return res.status(200).json({ sucesso: true, mensagem: "Orientação enviada!", destination, templateName, msgId: response.data?.data?.msgId });
  } catch (error) {
    console.log("Erro completo MaisChat:", JSON.stringify(error.response?.data, null, 2));
    return handleError(error, res);
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────

app.listen(config.port, () => console.log(`Servidor rodando em http://localhost:${config.port}`));
