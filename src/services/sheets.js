const axios = require("axios");
const config = require("../config");

let cache = null;

async function carregarPlanilha() {
  if (cache) return cache;
  const url = `https://docs.google.com/spreadsheets/d/${config.sheet.id}/gviz/tq?tqx=out:json&sheet=Página1`;
  const response = await axios.get(url, { headers: { Accept: "text/plain" } });
  const raw = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  const json = raw.replace(/^[^{]+/, "").replace(/[^}]+$/, "");
  const data = JSON.parse(json);
  const cols = data.table.cols.map(c => c.label);
  cache = data.table.rows.map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row.c[i]?.v ?? ""; });
    return obj;
  });
  console.log(`Planilha carregada: ${cache.length} procedimentos`);
  return cache;
}

async function buscarTemplateOrientacao(idProcedimento, nomeProcedimento) {
  const linhas = await carregarPlanilha();
  const encontrado = linhas.find(row => {
    const matchId = idProcedimento && String(row["Código"] || "").trim() === String(idProcedimento).trim();
    const matchNome = nomeProcedimento && (row["Descrição do Procedimento"] || "").toLowerCase().includes(nomeProcedimento.toLowerCase());
    return matchId || matchNome;
  });
  if (!encontrado) return null;
  const nomeArquivo = String(encontrado["Nome Arquivo"] || "").trim();
  if (!nomeArquivo) return null;
  return nomeArquivo
    .replace(/^\d+_/, "")
    .replace(/\.(png|jpg|jpeg|pdf)$/i, "");
}

setInterval(() => { cache = null; console.log("Cache da planilha limpo."); }, 60 * 60 * 1000);

module.exports = { carregarPlanilha, buscarTemplateOrientacao };
