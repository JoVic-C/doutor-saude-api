const axios = require("axios");
const config = require("../config");

const baseUrl = config.realclinic.baseUrl;
const auth = config.realclinic.auth;
const headers = { "Content-Type": "application/json", Authorization: config.realclinic.basicToken };

async function buscarPacientePorCelular(numeroFormatado) {
  const r = await axios.post(
    `${baseUrl}/PacienteIntegracao/BuscarPorCelular`,
    null,
    { params: { NumeroCelular: numeroFormatado }, auth, headers: { "Content-Type": "application/json" } }
  );
  return r.data;
}

async function buscarAgendamentosPaciente(idPaciente) {
  const url = `${baseUrl}/AgendamentoIntegracao/BuscaAgendamentoPaciente?pTidPaciente=${Number(idPaciente)}`;
  const r = await axios.post(url, Number(idPaciente), { headers });
  return r.data || [];
}

async function confirmarAgendamento(codigo) {
  await axios.post(`${baseUrl}/AgendamentoIntegracao/Confirmar`, Number(codigo), { headers });
}

async function cancelarAgendamento(codigo) {
  await axios.post(`${baseUrl}/AgendamentoIntegracao/Cancelar`, Number(codigo), { headers });
}

async function listarAgendamentosPorData(DataAgendamento) {
  const r = await axios.post(
    `${baseUrl}/AgendamentoIntegracaoX5/ListagemAgendamentoData`,
    { DataAgendamento },
    { auth, headers: { "Content-Type": "application/json" } }
  );
  return r.data || [];
}

// ListagemAgendamentoData não retorna Status; para descobrir, busca o paciente pelo
// celular, lista seus agendamentos e localiza o item pelo IdAgendamento.
async function buscarStatusAgendamento(numeroTelefone, idAgendamento, formatarParaRealclinic) {
  if (!numeroTelefone || !idAgendamento) return null;
  const paciente = await buscarPacientePorCelular(formatarParaRealclinic(numeroTelefone));
  if (!paciente?.Id) return null;
  const agendamentos = await buscarAgendamentosPaciente(paciente.Id);
  const encontrado = agendamentos.find((a) => Number(a.IdAgendamento) === Number(idAgendamento));
  return encontrado ? Number(encontrado.Status) : null;
}

module.exports = {
  buscarPacientePorCelular,
  buscarAgendamentosPaciente,
  confirmarAgendamento,
  cancelarAgendamento,
  listarAgendamentosPorData,
  buscarStatusAgendamento,
};
