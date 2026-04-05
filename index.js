const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// GET /confirmar é tratado mais abaixo com a lógica completa

// ─── Realclinic ───────────────────────────────────────────────────────────────
const REALCLINIC_BASE_URL = "https://doutorsaude.realclinic.com.br/doutorsaude/api";
const BASIC_AUTH = {
  username: "doutorsaude.tdsa",
  password: "9a29d3584fa0b69391b6a76c1bb9a1fd",
};

// ─── Mais Chat ────────────────────────────────────────────────────────────────
const MAISCHAT_BASE_URL = "https://api.maischat.io/v3";
const MAISCHAT_TOKEN    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnQiOiI2OTMxYTIzZDJlMWYxNTMwOWJkODVlNjkiLCJuYW1lIjoiRG91dG9yIFNhdWRlIiwiY25waiI6IjI1MzU3ODIxMDAwMTAwIiwiaWF0IjoxNzY0ODYwNDc3fQ.eDnjBFlw1uaiSSVz5OVK5U4uxtU_W5lXgyEoiNyqxD8";
const WHATSAPP_TOKEN    = "EAAD0ZA7Q5UxUBOyVaFIqYaA9r4abJHL2doTNSyymUpGEsZB1kuisIWo8EnrZACHgxMVAuNaY73KWRQmZAzZC7BKHX7HyR9LsMnMrG8PWAjYj86su9SkUBe2qaoihWlrzkru6x8yOUnWXNedzvjLpX3tW29ifFtZBB9ZAZB2JZB3cnOI5RIoJ9eEnlSu5F7iAirVlj";
const WHATSAPP_APP_ID   = "985087318002742";
const WHATSAPP_SOURCE   = "554330281200";
const TEMPLATE_NAME     = "confirma_agendamento_2";
const TEMPLATE_LANGUAGE = "pt_BR";

// ─── Google Sheets ───────────────────────────────────────────────────────────
const SHEET_ID  = "1fV4D638_ETaFYfoyJBWNbcXqQWAzTWSk3xbawwEEpZY";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

let orientacoesCache = null; // cache em memória para não buscar a cada requisição

async function buscarOrientacoes(idProcedimento, nomeProcedimento) {
  // Busca e faz cache da planilha
  if (!orientacoesCache) {
    const response = await axios.get(SHEET_URL, { headers: { "Accept": "text/plain" } });
    // Google retorna JSONP com prefixo/sufixo que precisa ser removido antes do JSON.parse
    const raw = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    console.log("Google Sheets raw (primeiros 200 chars):", raw.slice(0, 200));
    const json = raw
      .replace(/^[^{]+/, "")  // remove prefixo
      .replace(/[^}]+$/, ""); // remove sufixo
    const data = JSON.parse(json);
    const rows = data.table.rows;
    const cols = data.table.cols.map(c => c.label);

    orientacoesCache = rows.map(row => {
      const obj = {};
      cols.forEach((col, i) => {
        obj[col] = row.c[i]?.v ?? "";
      });
      return obj;
    });

    console.log(`Planilha carregada: ${orientacoesCache.length} procedimentos`);
    console.log("Colunas encontradas:", Object.keys(orientacoesCache[0] || {}));
    console.log("Primeira linha:", JSON.stringify(orientacoesCache[0]));
  }

  // Busca por Código ou Descrição do Procedimento
  const encontrado = orientacoesCache.find(row => {
    const matchId   = idProcedimento && String(row["Código"] || "").trim() === String(idProcedimento).trim();
    const matchNome = nomeProcedimento && (row["Descrição do Procedimento"] || "").toLowerCase().includes(nomeProcedimento.toLowerCase());
    return matchId || matchNome;
  });

  const texto = encontrado?.["Orientação"] || null;
  if (!texto) return null;
  return texto
    .replace(/^\"+|\"+$/g, "")   // remove aspas extras
    .replace(/\\n/g, "\n")       // converte \n literal em quebra de linha
    .replace(/\n/g, " ")           // converte quebras de linha em espaço (Meta não aceita)
    .replace(/\s+/g, " ")          // remove espaços duplos
    .trim();
}

// Corta o texto no último ponto final antes do limite
function cortarNaUltimaFrase(texto, limite) {
  if (texto.length <= limite) return [texto, ""];
  const trecho = texto.slice(0, limite);
  // Procura o último ponto final, exclamação ou interrogação
  let corte = Math.max(
    trecho.lastIndexOf(". "),
    trecho.lastIndexOf("! "),
    trecho.lastIndexOf("? ")
  );
  if (corte === -1) corte = trecho.lastIndexOf(" "); // fallback: último espaço
  if (corte === -1) corte = limite;
  else corte += 1; // inclui o ponto
  return [texto.slice(0, corte).trim(), texto.slice(corte).trim()];
}

// Divide o texto em até 3 partes cortando sempre na última frase completa
// Cada parte limitada a 1024 chars (limite da Meta por variável)
function dividirTexto(texto) {
  if (!texto) return [" ", " ", " "];

  // Cabe em 1 parte
  if (texto.length <= 1024) return [texto, " ", " "];

  // Divide em parte1 e resto
  const [parte1, resto1] = cortarNaUltimaFrase(texto, 1024);

  // Resto cabe em 1 parte
  if (resto1.length <= 1024) return [parte1, resto1, " "];

  // Divide o resto em parte2 e parte3
  const [parte2, parte3] = cortarNaUltimaFrase(resto1, 1024);

  return [parte1, parte2, parte3.slice(0, 1024)];
}

// Limpa o cache a cada 1 hora para pegar atualizações da planilha
setInterval(() => { orientacoesCache = null; console.log("Cache da planilha limpo."); }, 60 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normaliza celular para E.164
// Remove 55, adiciona 9 após DDD se necessário, retorna sem 55 (formato Realclinic)
function formatarParaRealclinic(celular) {
  let digitos = celular.replace(/\D/g, "");

  // Remove o 55 do início se vier do WhatsApp
  if (digitos.startsWith("55")) digitos = digitos.slice(2);

  // Extrai DDD (2 dígitos) e número
  const ddd = digitos.slice(0, 2);
  let numero = digitos.slice(2);

  // Adiciona o 9 se o número tiver 8 dígitos (ex: 84077687 → 984077687)
  if (numero.length === 8) numero = "9" + numero;

  return `${ddd}${numero}`; // ex: 48984077687
}

// Formata para E.164 (com 55) — usado no envio do WhatsApp
function formatarCelular(celular) {
  const digitos = celular.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}

// Extrai dia e mês de uma string de data
// Aceita: "2025-03-26T00:00:00Z" ou "26/03/2025" ou "2025-03-26"
function extrairDiaMes(dataStr) {
  if (!dataStr) return { dia: "??", mes: "??" };

  // Formato DD/MM/YYYY
  if (dataStr.includes("/")) {
    const [dia, mes] = dataStr.split("/");
    return { dia: dia.padStart(2, "0"), mes: mes.padStart(2, "0") };
  }

  // Formato ISO 2025-03-26 ou 2025-03-26T...
  const date = new Date(dataStr);
  if (!isNaN(date.getTime())) {
    const dia = String(date.getUTCDate()).padStart(2, "0");
    const mes = String(date.getUTCMonth() + 1).padStart(2, "0");
    return { dia, mes };
  }

  return { dia: "??", mes: "??" };
}

// Busca celular do paciente na Realclinic
async function buscarCelularPaciente(NumeroCelular) {
  const response = await axios.post(
    `${REALCLINIC_BASE_URL}/PacienteIntegracao/BuscarPorCelular`,
    null,
    {
      params: { NumeroCelular },
      auth: BASIC_AUTH,
      headers: { "Content-Type": "application/json" },
    }
  );
  return response.data?.Celular || null;
}

// Envia template via Mais Chat
// Template: "Olá, {{1}}. Tudo bem? ... Data: {{2}}/{{3}} ... Horário: {{4}} ... Profissional: {{5}}"
async function enviarTemplate({ destination, nomePaciente, dia, mes, horario, nomeProfissional, codigo = "", celular = "", nomeProc = "", idProc = "" }) {
  const body = {
    type: "apiTemplate",
    broker: "wppCloudAPI",
    appId: WHATSAPP_APP_ID,
    source: WHATSAPP_SOURCE,
    destination,
    token: WHATSAPP_TOKEN,
    template: {
      name: TEMPLATE_NAME,
      language: TEMPLATE_LANGUAGE,
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: nomePaciente },    // {{1}}
            { type: "text", text: dia },              // {{2}}
            { type: "text", text: mes },              // {{3}}
            { type: "text", text: horario },          // {{4}}
            { type: "text", text: nomeProfissional }, // {{5}}
          ],
        },
      ],
    },
  };

  const response = await axios.post(
    `${MAISCHAT_BASE_URL}/template/send/wppCloudAPI`,
    body,
    {
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${MAISCHAT_TOKEN}`,
      },
    }
  );

  return response.data;
}

// ─── Tratamento de erros ──────────────────────────────────────────────────────
function handleError(error, res) {
  if (error.response) {
    const status = error.response.status;
    if (status === 401) return res.status(401).json({ sucesso: false, mensagem: "Não autorizado." });
    if (status === 404) return res.status(404).json({ sucesso: false, mensagem: "Recurso não encontrado." });
    return res.status(status).json({ sucesso: false, mensagem: `Erro externo: ${error.response.statusText}`, detalhe: error.response.data });
  }
  return res.status(500).json({ sucesso: false, mensagem: "Erro de conexão.", detalhe: error.message });
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

/**
 * POST /paciente/celular
 * Body: { "NumeroCelular": "43999687979" }
 */
app.post("/paciente/celular", async (req, res) => {
  const { NumeroCelular } = req.body;
  if (!NumeroCelular) {
    return res.status(400).json({ sucesso: false, mensagem: "O campo 'NumeroCelular' é obrigatório." });
  }
  try {
    const response = await axios.post(
      `${REALCLINIC_BASE_URL}/PacienteIntegracao/BuscarPorCelular`,
      null,
      { params: { NumeroCelular }, auth: BASIC_AUTH, headers: { "Content-Type": "application/json" } }
    );
    return res.status(200).json({ sucesso: true, paciente: response.data });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/listagem-por-data
 * Body: { "DataAgendamento": "2025-03-26T00:00:00Z" }
 */
app.post("/agendamento/listagem-por-data", async (req, res) => {
  const { DataAgendamento } = req.body;
  if (!DataAgendamento) return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });

  const data = new Date(DataAgendamento);
  if (isNaN(data.getTime())) return res.status(400).json({ sucesso: false, mensagem: "Formato de data inválido. Use ISO 8601." });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  if (data < hoje) return res.status(400).json({ sucesso: false, mensagem: "Não são aceitos horários retroativos." });

  try {
    const response = await axios.post(
      `${REALCLINIC_BASE_URL}/AgendamentoIntegracaoX5/ListagemAgendamentoData`,
      { DataAgendamento },
      { auth: BASIC_AUTH, headers: { "Content-Type": "application/json" } }
    );
    return res.status(200).json({ sucesso: true, agendamentos: response.data });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/enviar-confirmacoes
 * Busca agendamentos da data e dispara template de confirmação em lote.
 * Body: { "DataAgendamento": "2025-03-26T00:00:00Z" }
 *
 * Template: "Olá, {{1}}. Tudo bem?
 *  Data: {{2}}/{{3}}
 *  Horário: {{4}}
 *  Profissional: {{5}}"
 */
app.post("/agendamento/enviar-confirmacoes", async (req, res) => {
  const { DataAgendamento } = req.body;

  if (!DataAgendamento) return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });

  const data = new Date(DataAgendamento);
  if (isNaN(data.getTime())) return res.status(400).json({ sucesso: false, mensagem: "Formato de data inválido. Use ISO 8601." });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  if (data < hoje) return res.status(400).json({ sucesso: false, mensagem: "Não são aceitos horários retroativos." });

  // 1. Busca agendamentos na Realclinic
  let agendamentos = [];
  try {
    const response = await axios.post(
      `${REALCLINIC_BASE_URL}/AgendamentoIntegracaoX5/ListagemAgendamentoData`,
      { DataAgendamento },
      { auth: BASIC_AUTH, headers: { "Content-Type": "application/json" } }
    );
    agendamentos = response.data || [];
  } catch (error) {
    return handleError(error, res);
  }

  if (agendamentos.length === 0) {
    return res.status(200).json({
      sucesso: true,
      mensagem: "Nenhum agendamento encontrado para a data informada.",
      total: 0, totalEnviados: 0, totalFalhas: 0,
      enviados: [], falhas: [],
    });
  }

  // 2. Para cada agendamento: busca celular e envia template
  const enviados = [];
  const falhas   = [];

  for (const agendamento of agendamentos) {
    const { NomePaciente, Horario, NomeProfissional, DataAgendamento: DataAg, Codigo, NumeroTelefone } = agendamento;

    try {
      if (!NumeroTelefone) {
        falhas.push({ Codigo, NomePaciente, motivo: "NumeroTelefone não encontrado no agendamento." });
        continue;
      }

      const destination = formatarCelular(NumeroTelefone);
      const { dia, mes } = extrairDiaMes(DataAg || DataAgendamento);

      // Envia template
      const resultado = await enviarTemplate({
        destination,
        nomePaciente: NomePaciente,
        dia,
        mes,
        horario: Horario,
        nomeProfissional: NomeProfissional,
        codigo: Codigo,
        celular: NumeroTelefone,
        nomeProc: agendamento.NomeProcedimento || "",
        idProc: agendamento.NumeroTelefone || "",
      });

      if (resultado?.data?.status === false) {
        falhas.push({ Codigo, NomePaciente, destination, motivo: resultado.data.message, detalhe: resultado.data.error });
      } else {
        enviados.push({ Codigo, NomePaciente, destination, msgId: resultado?.data?.msgId });
      }

    } catch (err) {
      falhas.push({
        Codigo,
        NomePaciente,
        motivo: err.response?.data?.message || err.message,
      });
    }
  }

  return res.status(200).json({
    sucesso: true,
    total: agendamentos.length,
    totalEnviados: enviados.length,
    totalFalhas: falhas.length,
    enviados,
    falhas,
  });
});

/**
 * POST /agendamento/confirmar
 * Chamado pela página HTML quando paciente clica em CONFIRMAR.
 * Envia orientação por WhatsApp.
 */
app.post("/agendamento/confirmar", async (req, res) => {
  const { codigo, celular, nome, data, horario, prof, proc, idProc } = req.body;

  if (!celular) return res.status(400).json({ sucesso: false, mensagem: "Celular não informado." });

  // 1. Confirma o agendamento na Realclinic
  try {
    await axios.post(
      `${REALCLINIC_BASE_URL}/AgendamentoIntegracao/Confirmar`,
      Number(codigo),
      {
        auth: BASIC_AUTH,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic ZG91dG9yc2F1ZGUudGRzYTo5YTI5ZDM1ODRmYTBiNjkzOTFiNmE3NmMxYmI5YTFmZA==",
        },
      }
    );
    console.log(`Agendamento ${codigo} confirmado na Realclinic!`);
  } catch (e) {
    console.log(`Erro ao confirmar na Realclinic:`, e.response?.data || e.message);
  }

  // 2. Busca orientação na planilha
  let orientacao = null;
  try {
    orientacao = await buscarOrientacoes(idProc, proc);
  } catch (e) {
    console.log("Erro ao buscar orientação:", e.message);
  }

  if (!orientacao) {
    orientacao = "Apresente documento de identificação e cartão do convênio. Em caso de dúvidas, entre em contato.";
  }

  // 3. Envia template de orientação via Mais Chat
  try {
    const destination = formatarCelular(celular);
    const body = {
      type: "apiTemplate",
      broker: "wppCloudAPI",
      appId: WHATSAPP_APP_ID,
      source: WHATSAPP_SOURCE,
      destination,
      token: WHATSAPP_TOKEN,
      template: {
        name: "confirmacao_e_orientacao_v2",
        language: TEMPLATE_LANGUAGE,
        components: [
          {
            type: "body",
            parameters: [
              ...(() => {
                const partes = dividirTexto(orientacao);
                console.log("Partes:", partes.map((p,i) => `{{${i+1}}}: ${p.length} chars`));
                return partes.map(p => ({ type: "text", text: p }));
              })(),
            ],
          },
        ],
      },
    };

    const response = await axios.post(
      `${MAISCHAT_BASE_URL}/template/send/wppCloudAPI`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${MAISCHAT_TOKEN}`,
        },
      }
    );

    console.log(`Orientação enviada — Código: ${codigo} | Paciente: ${nome}`);

    return res.status(200).json({
      sucesso: true,
      mensagem: "Consulta confirmada e orientação enviada!",
      msgId: response.data?.data?.msgId,
    });

  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /agendamento/cancelar
 * Chamado pela página HTML quando paciente clica em CANCELAR.
 */
app.post("/agendamento/cancelar", async (req, res) => {
  const { codigo, celular, nome } = req.body;

  console.log(`Cancelamento registrado — Código: ${codigo} | Paciente: ${nome} | Celular: ${celular}`);

  // Aqui você pode integrar com a Realclinic para cancelar o agendamento
  // Por enquanto apenas registra o cancelamento

  return res.status(200).json({
    sucesso: true,
    mensagem: "Cancelamento registrado com sucesso.",
  });
});

// Health check
app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});



/**
 * POST /agendamento/enviar-confirmacao-unitaria
 * Busca agendamentos do paciente na Realclinic pelo celular e envia template.
 * Body: { "NumeroCelular": "554884077687" }
 */
app.post("/agendamento/enviar-confirmacao-unitaria", async (req, res) => {
  const { NumeroCelular } = req.body;

  if (!NumeroCelular) {
    return res.status(400).json({ sucesso: false, mensagem: "O campo \'NumeroCelular\' é obrigatório." });
  }

  // 1. Busca paciente pelo celular para obter o Id
  let paciente;
  try {
    const numeroBusca = formatarParaRealclinic(NumeroCelular);
    console.log("Buscando paciente com número:", numeroBusca);
    const responsePaciente = await axios.post(
      `${REALCLINIC_BASE_URL}/PacienteIntegracao/BuscarPorCelular`,
      null,
      {
        params: { NumeroCelular: numeroBusca },
        auth: BASIC_AUTH,
        headers: { "Content-Type": "application/json" },
      }
    );
    paciente = responsePaciente.data;
  } catch (error) {
    return handleError(error, res);
  }

  const idPaciente = paciente.Id;

  if (!idPaciente) {
    return res.status(404).json({ sucesso: false, mensagem: "Id do paciente não encontrado." });
  }

  // 2. Busca agendamentos usando o Id do paciente (pTidPaciente)
  let agendamentos = [];
  try {
    const urlAgendamento = `${REALCLINIC_BASE_URL}/AgendamentoIntegracao/BuscaAgendamentoPaciente`;
    console.log("URL chamada:", urlAgendamento, "| pTidPaciente:", Number(idPaciente));
    const responseAg = await axios.post(
      urlAgendamento,
      Number(idPaciente),
      {
        auth: BASIC_AUTH,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic ZG91dG9yc2F1ZGUudGRzYTo5YTI5ZDM1ODRmYTBiNjkzOTFiNmE3NmMxYmI5YTFmZA==",
        },
      }
    );
    agendamentos = responseAg.data || [];
  } catch (error) {
    return handleError(error, res);
  }

  if (!agendamentos || agendamentos.length === 0) {
    return res.status(404).json({ sucesso: false, mensagem: "Nenhum agendamento encontrado para este paciente." });
  }

  // 3. Pega o primeiro agendamento
  const agendamento = agendamentos[0];

  const destination      = formatarCelular(NumeroCelular);
  const nomePaciente     = agendamento.NomePaciente || agendamento.NomeProcedimento || "Paciente";
  const nomeProfissional = agendamento.NomeProfissional || "";
  const { dia, mes }     = extrairDiaMes(agendamento.Data);
  const horario          = agendamento.Data
    ? new Date(agendamento.Data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    : "";

  // 3. Envia template
  try {
    const resultado = await enviarTemplate({
      destination,
      nomePaciente,
      dia,
      mes,
      horario,
      nomeProfissional,
      codigo: agendamento.IdAgendamento || "",
      celular: NumeroCelular,
      nomeProc: agendamento.NomeProcedimento || "",
      idProc: agendamento.IdProcedimento || "",
    });

    if (resultado?.data?.status === false) {
      return res.status(400).json({
        sucesso: false,
        mensagem: resultado.data.message,
        detalhe: resultado.data.error,
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: "Confirmação enviada com sucesso!",
      agendamento: {
        nome: nomePaciente,
        celular: destination,
        profissional: nomeProfissional,
        especialidade: agendamento.NomeEspecialidade || "",
        convenio: agendamento.NomeConvenio || "",
        plano: agendamento.NomePlano || "",
        dia,
        mes,
        horario,
      },
      msgId: resultado?.data?.msgId,
    });

  } catch (error) {
    return handleError(error, res);
  }
});

// Health check

/**
 * POST /procedimento/buscar-por-agendamento
 * Busca agendamentos da data e retorna os procedimentos de cada um.
 * Body: { "DataAgendamento": "2025-04-05T00:00:00Z" }
 */
app.post("/procedimento/buscar-por-agendamento", async (req, res) => {
  const { DataAgendamento } = req.body;

  if (!DataAgendamento) {
    return res.status(400).json({ sucesso: false, mensagem: "O campo 'DataAgendamento' é obrigatório." });
  }

  // 1. Busca agendamentos da data
  let agendamentos = [];
  try {
    const response = await axios.post(
      `${REALCLINIC_BASE_URL}/AgendamentoIntegracaoX5/ListagemAgendamentoData`,
      { DataAgendamento },
      { auth: BASIC_AUTH, headers: { "Content-Type": "application/json" } }
    );
    agendamentos = response.data || [];
  } catch (error) {
    return handleError(error, res);
  }

  if (agendamentos.length === 0) {
    return res.status(200).json({ sucesso: true, mensagem: "Nenhum agendamento encontrado.", resultado: [] });
  }

  // 2. Para cada agendamento, busca os procedimentos
  const resultado = [];

  for (const agendamento of agendamentos) {
    const { NomePaciente, Horario, NomeProfissional, NomeEspecialidade, Codigo, NumeroTelefone } = agendamento;

    try {
      const resProcedimento = await axios.post(
        `${REALCLINIC_BASE_URL}/ProcedimentoIntegracao/PesquisarProcedimentos`,
        {
          NomeProcedimento: agendamento.NomeProcedimento || "",
          NomeProfissional: NomeProfissional || "",
        },
        { auth: BASIC_AUTH, headers: { "Content-Type": "application/json" } }
      );

      resultado.push({
        Codigo,
        NomePaciente,
        NumeroTelefone,
        Horario,
        NomeProfissional,
        NomeEspecialidade,
        NomeProcedimento: agendamento.NomeProcedimento || "",
        procedimentos: resProcedimento.data || [],
      });

    } catch (err) {
      resultado.push({
        Codigo,
        NomePaciente,
        NumeroTelefone,
        Horario,
        NomeProfissional,
        NomeEspecialidade,
        NomeProcedimento: agendamento.NomeProcedimento || "",
        procedimentos: [],
        erro: err.response?.data || err.message,
      });
    }
  }

  return res.status(200).json({
    sucesso: true,
    total: agendamentos.length,
    resultado,
  });
});

/**
 * GET /procedimento/orientacoes?id=203&nome=USG
 * Testa a busca de orientações na planilha Google Sheets.
 */
app.get("/procedimento/orientacoes", async (req, res) => {
  const { id, nome } = req.query;

  if (!id && !nome) {
    return res.status(400).json({ sucesso: false, mensagem: "Informe 'id' ou 'nome' como query param." });
  }

  try {
    const orientacao = await buscarOrientacoes(id, nome);

    if (!orientacao) {
      return res.status(404).json({ sucesso: false, mensagem: "Orientação não encontrada para este procedimento." });
    }

    return res.status(200).json({ sucesso: true, orientacao });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /orientacao/enviar-teste
 * Testa o envio do template de orientação sem confirmar na Realclinic.
 * Body: { "celular": "48984077687", "proc": "USG - ABDOME TOTAL", "idProc": "203" }
 */
app.post("/orientacao/enviar-teste", async (req, res) => {
  const { celular, proc, idProc } = req.body;

  if (!celular) return res.status(400).json({ sucesso: false, mensagem: "O campo 'celular' é obrigatório." });

  // 1. Busca orientação na planilha
  let orientacao = null;
  try {
    orientacao = await buscarOrientacoes(idProc, proc);
    console.log("Orientação encontrada:", orientacao ? "Sim" : "Não");
  } catch (e) {
    console.log("Erro ao buscar orientação:", e.message);
  }

  if (!orientacao) {
    return res.status(404).json({
      sucesso: false,
      mensagem: "Orientação não encontrada na planilha para este procedimento.",
      dica: "Verifique se o Código ou Descrição do Procedimento existe na planilha.",
    });
  }

  // 2. Envia template de orientação
  try {
    const destination = formatarCelular(celular);
    const body = {
      type: "apiTemplate",
      broker: "wppCloudAPI",
      appId: WHATSAPP_APP_ID,
      source: WHATSAPP_SOURCE,
      destination,
      token: WHATSAPP_TOKEN,
      template: {
        name: "confirmacao_e_orientacao_v2",
        language: TEMPLATE_LANGUAGE,
        components: [
          {
            type: "body",
            parameters: [
              ...(() => {
                const partes = dividirTexto(orientacao);
                console.log("Partes:", partes.map((p,i) => `{{${i+1}}}: ${p.length} chars`));
                return partes.map(p => ({ type: "text", text: p }));
              })(),
            ],
          },
        ],
      },
    };

    const response = await axios.post(
      `${MAISCHAT_BASE_URL}/template/send/wppCloudAPI`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${MAISCHAT_TOKEN}`,
        },
      }
    );

    return res.status(200).json({
      sucesso: true,
      mensagem: "Orientação enviada com sucesso!",
      destination,
      orientacao,
      msgId: response.data?.data?.msgId,
    });

  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /confirmar
 * Chamado diretamente pelo botão do template WhatsApp.
 * Confirma agendamento + envia orientação automaticamente.
 * Params: ?codigo=398459&celular=48984077687&proc=USG...&idProc=203&nome=João&horario=13:00&prof=Dr.Carlos&data=05/04
 */
app.get("/confirmar", async (req, res) => {
  const { codigo, celular, proc, idProc, nome, horario, prof, data } = req.query;

  if (!codigo || !celular) {
    return res.send(paginaResposta("⚠️", "Dados inválidos", "Link de confirmação inválido. Entre em contato com a clínica.", "#f59e0b"));
  }

  // 1. Confirma na Realclinic
  try {
    await axios.post(
      `${REALCLINIC_BASE_URL}/AgendamentoIntegracao/Confirmar`,
      Number(codigo),
      {
        auth: BASIC_AUTH,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Basic ZG91dG9yc2F1ZGUudGRzYTo5YTI5ZDM1ODRmYTBiNjkzOTFiNmE3NmMxYmI5YTFmZA==",
        },
      }
    );
    console.log(`Agendamento ${codigo} confirmado!`);
  } catch (e) {
    console.log("Erro ao confirmar na Realclinic:", e.response?.data || e.message);
  }

  // 2. Busca orientação na planilha
  let orientacao = null;
  try {
    orientacao = await buscarOrientacoes(idProc, proc);
  } catch (e) {
    console.log("Erro ao buscar orientação:", e.message);
  }

  if (!orientacao) {
    orientacao = "Apresente documento de identificação e cartão do convênio. Em caso de dúvidas, entre em contato.";
  }

  // 3. Envia template de orientação via WhatsApp
  try {
    const destination = formatarCelular(celular);
    await axios.post(
      `${MAISCHAT_BASE_URL}/template/send/wppCloudAPI`,
      {
        type: "apiTemplate",
        broker: "wppCloudAPI",
        appId: WHATSAPP_APP_ID,
        source: WHATSAPP_SOURCE,
        destination,
        token: WHATSAPP_TOKEN,
        template: {
          name: "confirmacao_e_orientacao_v2",
          language: TEMPLATE_LANGUAGE,
          components: [
            { type: "body", parameters: [{ type: "text", text: orientacao }] },
          ],
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${MAISCHAT_TOKEN}`,
        },
      }
    );
    console.log(`Orientação enviada para ${destination}`);
  } catch (e) {
    console.log("Erro ao enviar orientação:", e.message);
  }

  // 4. Retorna página de sucesso
  return res.send(paginaResposta(
    "✅",
    "Consulta confirmada!",
    `Olá, ${nome || "paciente"}! Sua consulta do dia <strong>${data || "--"}</strong> às <strong>${horario || "--"}</strong> com <strong>${prof || "--"}</strong> foi confirmada.<br><br>As orientações foram enviadas para o seu WhatsApp.`,
    "#0a6e4e"
  ));
});

/**
 * GET /cancelar
 * Chamado diretamente pelo botão cancelar do template WhatsApp.
 */
app.get("/cancelar", async (req, res) => {
  const { codigo, celular, nome, horario, prof, data } = req.query;

  console.log(`Cancelamento — Código: ${codigo} | Paciente: ${nome} | Celular: ${celular}`);

  // Aqui pode integrar com endpoint de cancelamento da Realclinic futuramente

  return res.send(paginaResposta(
    "❌",
    "Consulta cancelada.",
    `Sua consulta do dia <strong>${data || "--"}</strong> às <strong>${horario || "--"}</strong> foi cancelada.<br><br>Entre em contato para reagendar.`,
    "#c0392b"
  ));
});

// Helper — gera página HTML simples de resposta
function paginaResposta(icone, titulo, mensagem, cor) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Clínica Doutor Saúde</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:white;border-radius:16px;padding:40px 28px;max-width:400px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center}
    .icone{font-size:56px;margin-bottom:16px}
    h1{font-size:22px;color:${cor};margin-bottom:12px}
    p{font-size:15px;color:#555;line-height:1.6}
    .logo{font-size:13px;color:#aaa;margin-top:24px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icone">${icone}</div>
    <h1>${titulo}</h1>
    <p>${mensagem}</p>
    <div class="logo">Clínica Doutor Saúde</div>
  </div>
</body>
</html>`;
}