// ── ASAP Sales Hub — API de Prospecção de Leads ──────────────────────────────
// Vercel Serverless Function
// Busca leads no Brasil.io (API pública) e CNPJ.biz (scraping)

const axios = require('axios');
const cheerio = require('cheerio');

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── 1. BRASIL.IO — API pública de CNPJs ──────────────────────────────────────
async function fetchBrasilIO({ cnae, uf, limit = 20, page = 1 }) {
  try {
    const url = `https://brasilaberto.com/api/v1/company/search`;
    // Brasil Aberto — proxy público sem autenticação
    const params = {
      cnae: cnae || '4649401',
      uf: uf || 'RS',
      limit,
      page,
    };
    const res = await axios.get(url, { params, timeout: 8000 });
    const companies = (res.data?.data || res.data?.results || []).slice(0, limit);
    return companies.map(c => ({
      empresa:   c.name || c.razao_social || c.company_name || '—',
      cnpj:      c.cnpj || '—',
      cidade:    c.city || c.municipio || '—',
      uf:        c.uf || c.state || uf,
      segmento:  cnaeToSegmento(cnae),
      porte:     porteFromCapital(c.capital_social),
      situacao:  c.situation || c.situacao || 'Ativa',
      fonte:     'Brasil.io / CNAE',
      status:    'Em qualificação',
      temperatura: '🔵 Frio',
      score:     '—',
      produto:   '—',
      valor:     '—',
      origem_prosp: true,
      data:      new Date().toLocaleDateString('pt-BR'),
    }));
  } catch (e) {
    console.error('BrasilIO error:', e.message);
    return [];
  }
}

// ── 2. CNPJ.BIZ — scraping por CNAE + UF ────────────────────────────────────
async function fetchCNPJbiz({ cnae, uf, limit = 20 }) {
  try {
    const url = `https://cnpj.biz/pesquisa/${cnae}/${uf}`;
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ASAP-Bot/1.0)',
        'Accept': 'text/html',
      }
    });
    const $ = cheerio.load(html);
    const results = [];
    // Parse company rows from CNPJ.biz table
    $('table tbody tr, .empresa-item, .result-row').each((i, el) => {
      if (i >= limit) return false;
      const cols = $(el).find('td');
      const nome = cols.eq(0).text().trim() || $(el).find('.nome, .razao').text().trim();
      const cnpj = cols.eq(1).text().trim() || $(el).find('.cnpj').text().trim();
      const cidade = cols.eq(2).text().trim() || $(el).find('.municipio').text().trim();
      if (nome && nome.length > 2) {
        results.push({
          empresa:   nome,
          cnpj:      cnpj || '—',
          cidade:    cidade || '—',
          uf:        uf,
          segmento:  cnaeToSegmento(cnae),
          porte:     '—',
          situacao:  'Ativa',
          fonte:     'CNPJ.biz',
          status:    'Em qualificação',
          temperatura: '🔵 Frio',
          score:     '—',
          produto:   '—',
          valor:     '—',
          origem_prosp: true,
          data:      new Date().toLocaleDateString('pt-BR'),
        });
      }
    });
    return results.slice(0, limit);
  } catch (e) {
    console.error('CNPJbiz error:', e.message);
    return [];
  }
}

// ── 3. RECEITAWS — API gratuita de CNPJ individual ───────────────────────────
async function enrichCNPJ(cnpj) {
  if (!cnpj || cnpj === '—') return {};
  const clean = cnpj.replace(/\D/g, '');
  try {
    const { data } = await axios.get(`https://receitaws.com.br/v1/cnpj/${clean}`, {
      timeout: 5000
    });
    return {
      email:    data.email || '',
      telefone: data.telefone || '',
      porte:    porteFromReceitaWS(data.porte),
      endereco: `${data.logradouro||''}, ${data.municipio||''} - ${data.uf||''}`.trim(),
      situacao: data.situacao || 'ATIVA',
    };
  } catch (e) {
    return {};
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function cnaeToSegmento(cnae) {
  const str = String(cnae || '');
  if (str.startsWith('464') || str.startsWith('463') || str.startsWith('465')) return 'Distribuidor';
  if (str.startsWith('46') || str.startsWith('51')) return 'Importador';
  if (str.startsWith('471') || str.startsWith('472') || str.startsWith('476')) return 'Varejo';
  if (str.startsWith('10') || str.startsWith('22') || str.startsWith('32')) return 'Indústria';
  return 'Distribuidor';
}

function porteFromCapital(capital) {
  const v = parseFloat(String(capital || '0').replace(/[^\d.]/g, ''));
  if (v <= 0)       return '—';
  if (v < 360000)   return 'Micro';
  if (v < 4800000)  return 'Pequeno';
  if (v < 300000000) return 'Médio';
  return 'Grande';
}

function porteFromReceitaWS(porte) {
  const p = (porte || '').toUpperCase();
  if (p.includes('MICRO') || p.includes('MEI')) return 'Micro';
  if (p.includes('PEQUENO') || p.includes('EPP')) return 'Pequeno';
  if (p.includes('MEDIO') || p.includes('MÉDIO')) return 'Médio';
  if (p.includes('GRANDE')) return 'Grande';
  return '—';
}

function dedup(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const key = (l.cnpj && l.cnpj !== '—') ? l.cnpj : l.empresa.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    cnaes   = '4649401,4644301,4645101',
    ufs     = 'RS,SC,PR',
    limit   = 50,
    enrich  = 'false',
    fonte   = 'all',
  } = req.query;

  const cnaeList = cnaes.split(',').map(s => s.trim()).filter(Boolean);
  const ufList   = ufs.split(',').map(s => s.trim()).filter(Boolean);
  const perQuery = Math.ceil(Number(limit) / (cnaeList.length * ufList.length));

  let all = [];

  for (const cnae of cnaeList) {
    for (const uf of ufList) {
      if (fonte !== 'cnpjbiz') {
        const bio = await fetchBrasilIO({ cnae, uf, limit: perQuery });
        all = all.concat(bio);
      }
      if (fonte !== 'brasilaberto') {
        const cbiz = await fetchCNPJbiz({ cnae, uf, limit: perQuery });
        all = all.concat(cbiz);
      }
    }
  }

  // Deduplicate
  all = dedup(all).slice(0, Number(limit));

  // Optional enrichment (slow — only when requested)
  if (enrich === 'true') {
    all = await Promise.all(all.map(async lead => {
      if (lead.cnpj && lead.cnpj !== '—') {
        const extra = await enrichCNPJ(lead.cnpj);
        return { ...lead, ...extra };
      }
      return lead;
    }));
  }

  // Add unique IDs
  all = all.map((l, i) => ({ ...l, id: Date.now() + i }));

  res.status(200).json({
    total: all.length,
    timestamp: new Date().toISOString(),
    leads: all,
  });
};
