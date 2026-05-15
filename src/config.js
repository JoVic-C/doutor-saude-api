require("dotenv").config();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  baseUrl: process.env.BASE_URL,

  realclinic: {
    baseUrl: process.env.REALCLINIC_BASE_URL,
    auth: {
      username: process.env.REALCLINIC_USERNAME,
      password: process.env.REALCLINIC_PASSWORD,
    },
    basicToken: process.env.REALCLINIC_BASIC_TOKEN,
  },

  maischat: {
    baseUrl: process.env.MAISCHAT_BASE_URL,
    token: process.env.MAISCHAT_TOKEN,
  },

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    appId: process.env.WHATSAPP_APP_ID,
    source: process.env.WHATSAPP_SOURCE,
  },

  templates: {
    confirmacao: process.env.TEMPLATE_CONFIRMACAO,
    orientacao: process.env.TEMPLATE_ORIENTACAO,
    lembrete: process.env.TEMPLATE_LEMBRETE,
    language: process.env.TEMPLATE_LANGUAGE || "pt_BR",
  },

  sheet: {
    id: process.env.SHEET_ID,
  },

  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== "false",
    cron: process.env.SCHEDULER_CRON || "0 9 * * *",
    timezone: process.env.SCHEDULER_TIMEZONE || "America/Sao_Paulo",
    diasConfirmacao: Number(process.env.SCHEDULER_DIAS_CONFIRMACAO) || 3,
    diasLembrete: Number(process.env.SCHEDULER_DIAS_LEMBRETE) || 1,
  },
};
