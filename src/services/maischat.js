const axios = require("axios");
const config = require("../config");

async function enviarTemplate(payload) {
  return axios.post(
    `${config.maischat.baseUrl}/template/send/wppCloudAPI`,
    payload,
    { headers: { "Content-Type": "application/json", authorization: `Bearer ${config.maischat.token}` } }
  );
}

function payloadBase(destination) {
  return {
    type: "apiTemplate",
    broker: "wppCloudAPI",
    appId: config.whatsapp.appId,
    source: config.whatsapp.source,
    destination,
    token: config.whatsapp.token,
  };
}

async function enviarConfirmacao(destination, { nomePaciente, dia, mes, horario, nomeProfissional, urlParams, urlParamsCancelar }) {
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: nomePaciente },
        { type: "text", text: dia },
        { type: "text", text: mes },
        { type: "text", text: horario },
        { type: "text", text: nomeProfissional },
      ],
    },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlParams }] },
  ];
  if (urlParamsCancelar) {
    components.push({ type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: urlParamsCancelar }] });
  }
  return enviarTemplate({
    ...payloadBase(destination),
    template: {
      name: config.templates.confirmacao,
      language: config.templates.language,
      components,
    },
  });
}

async function enviarOrientacaoTemplate(destination, templateName) {
  return enviarTemplate({
    ...payloadBase(destination),
    template: {
      name: templateName,
      language: config.templates.language,
      components: [],
    },
  });
}

// Envia o template único de orientação (config.templates.orientacao) com o texto da
// planilha dividido em 3 variáveis de body — formato esperado pelo template
// confirmacao_e_orientacao_v2.
async function enviarOrientacaoComTexto(destination, partes) {
  return enviarTemplate({
    ...payloadBase(destination),
    template: {
      name: config.templates.orientacao,
      language: config.templates.language,
      components: [{
        type: "body",
        parameters: partes.map((p) => ({ type: "text", text: p })),
      }],
    },
  });
}

async function enviarLembrete(destination, { nomePaciente, dataFormatada, horario, nomeProfissional }) {
  return enviarTemplate({
    ...payloadBase(destination),
    template: {
      name: config.templates.lembrete,
      language: config.templates.language,
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: nomePaciente || "Paciente" },
          { type: "text", text: dataFormatada },
          { type: "text", text: horario || "" },
          { type: "text", text: nomeProfissional || "" },
        ],
      }],
    },
  });
}

module.exports = { enviarTemplate, enviarConfirmacao, enviarOrientacaoTemplate, enviarOrientacaoComTexto, enviarLembrete };
