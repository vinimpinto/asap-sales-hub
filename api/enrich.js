// Enriquece um CNPJ individual com dados da ReceitaWS (gratuito)
const axios = require('axios');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { cnpj } = req.query;
  if (!cnpj) return res.status(400).json({ error: 'cnpj required' });

  const clean = cnpj.replace(/\D/g, '');
  try {
    const { data } = await axios.get(`https://receitaws.com.br/v1/cnpj/${clean}`, {
      timeout: 8000
    });
    res.status(200).json({
      empresa:   data.nome || '',
      fantasia:  data.fantasia || '',
      email:     data.email || '',
      telefone:  data.telefone || '',
      endereco:  `${data.logradouro||''} ${data.numero||''}, ${data.municipio||''} - ${data.uf||''}`,
      situacao:  data.situacao || '',
      porte:     data.porte || '',
      abertura:  data.abertura || '',
      capital:   data.capital_social || '',
      atividade: (data.atividade_principal || [{}])[0]?.text || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
