function formatarParaRealclinic(celular) {
  let digitos = celular.replace(/\D/g, "");
  if (digitos.startsWith("55")) digitos = digitos.slice(2);
  const ddd = digitos.slice(0, 2);
  let numero = digitos.slice(2);
  if (numero.length === 8) numero = "9" + numero;
  return `${ddd}${numero}`;
}

function formatarCelular(celular) {
  const digitos = celular.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}

function extrairDiaMes(dataStr) {
  if (!dataStr) return { dia: "??", mes: "??" };
  if (dataStr.includes("/")) {
    const [dia, mes] = dataStr.split("/");
    return { dia: dia.padStart(2, "0"), mes: mes.padStart(2, "0") };
  }
  const date = new Date(dataStr);
  if (!isNaN(date.getTime())) {
    return {
      dia: String(date.getUTCDate()).padStart(2, "0"),
      mes: String(date.getUTCMonth() + 1).padStart(2, "0"),
    };
  }
  return { dia: "??", mes: "??" };
}

function handleError(error, res) {
  if (error.response) {
    const status = error.response.status;
    if (status === 401) return res.status(401).json({ sucesso: false, mensagem: "Não autorizado." });
    if (status === 404) return res.status(404).json({ sucesso: false, mensagem: "Recurso não encontrado." });
    return res.status(status).json({ sucesso: false, mensagem: `Erro externo: ${error.response.statusText}`, detalhe: error.response.data });
  }
  return res.status(500).json({ sucesso: false, mensagem: "Erro de conexão.", detalhe: error.message });
}

function paginaResposta(icone, titulo, mensagem, cor) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Clínica Doutor Saúde</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;border-radius:16px;padding:40px 28px;max-width:400px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center}.icone{font-size:56px;margin-bottom:16px}h1{font-size:22px;color:${cor};margin-bottom:12px}p{font-size:15px;color:#555;line-height:1.6}.logo{font-size:13px;color:#aaa;margin-top:24px}</style></head><body><div class="card"><div class="icone">${icone}</div><h1>${titulo}</h1><p>${mensagem}</p><div class="logo">Clínica Doutor Saúde</div></div></body></html>`;
}

// Corta o texto no último ponto/espaço antes do limite (Meta exige até 1024 chars por variável)
function cortarNaUltimaFrase(texto, limite) {
  if (texto.length <= limite) return [texto, ""];
  const trecho = texto.slice(0, limite);
  let corte = Math.max(
    trecho.lastIndexOf(". "),
    trecho.lastIndexOf("! "),
    trecho.lastIndexOf("? ")
  );
  if (corte === -1) corte = trecho.lastIndexOf(" ");
  if (corte === -1) corte = limite;
  else corte += 1;
  return [texto.slice(0, corte).trim(), texto.slice(corte).trim()];
}

// Divide o texto em até N partes de até 1024 chars cada (limite da Meta por variável).
// Total máximo = N×1024 chars. Garante N elementos não-vazios (preenche com " ").
function dividirTexto(texto, n = 6) {
  if (!texto) return Array(n).fill(" ");
  const partes = [];
  let resto = texto;
  while (partes.length < n - 1 && resto.length > 1024) {
    const [parte, sobra] = cortarNaUltimaFrase(resto, 1024);
    partes.push(parte || " ");
    resto = sobra;
  }
  partes.push((resto || " ").slice(0, 1024));
  while (partes.length < n) partes.push(" ");
  return partes;
}

module.exports = { formatarParaRealclinic, formatarCelular, extrairDiaMes, handleError, paginaResposta, dividirTexto };
