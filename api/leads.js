// ASAP Sales Hub — API de Prospecção
// Usa ReceitaWS (gratuita, sem auth) + CNPJ.info como fallback

const axios = require('axios');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Busca empresas por CNAE via API pública da ReceitaWS / CNPJ.info
async function fetchPorCNAE({ cnae, uf, limit }) {
  const results = [];

  // ── Fonte 1: brasilaberto.com ──────────────────────────────────────────────
  try {
    const r = await axios.get('https://brasilaberto.com/api/v1/company/search', {
      params: { cnae, uf, per_page: limit },
      timeout: 8000,
      headers: { 'Accept': 'application/json' }
    });
    const items = r.data?.result || r.data?.data || r.data?.results || [];
    items.forEach(c => {
      results.push({
        empresa:  c.company_name || c.name || c.razao_social || '—',
        cnpj:     formatCNPJ(c.cnpj || ''),
        cidade:   c.city || c.municipio || '—',
        uf:       c.uf || uf,
        segmento: cnaeToSeg(cnae),
        porte:    porteFromCapital(c.capital_social),
        fonte:    'Brasil Aberto',
        email:    c.email || '',
        telefone: c.phone || c.telefone || '',
      });
    });
  } catch(e) {
    console.log('BrasilAberto:', e.message);
  }

  // ── Fonte 2: CNPJA (open API) ──────────────────────────────────────────────
  if (results.length < limit) {
    try {
      const r2 = await axios.get(`https://api.cnpja.com/office/search`, {
        params: { activity: cnae, state: uf, limit, status: 2 },
        timeout: 8000,
        headers: { 'Accept': 'application/json', 'Authorization': 'open' }
      });
      const items2 = r2.data?.data || r2.data?.offices || [];
      items2.forEach(c => {
        const name = c.company?.name || c.alias || c.name || '';
        if (!name) return;
        results.push({
          empresa:  name,
          cnpj:     formatCNPJ(c.taxId || c.cnpj || ''),
          cidade:   c.address?.city || '—',
          uf:       c.address?.state || uf,
          segmento: cnaeToSeg(cnae),
          porte:    porteFromStr(c.company?.size?.id || ''),
          fonte:    'CNPJA',
          email:    c.emails?.[0]?.address || '',
          telefone: c.phones?.[0]?.number || '',
        });
      });
    } catch(e) {
      console.log('CNPJA:', e.message);
    }
  }

  // ── Fonte 3: ReceitaWS search (fallback) ───────────────────────────────────
  if (results.length < 3) {
    try {
      const r3 = await axios.get(`https://receitaws.com.br/v1/cnpj/search`, {
        params: { query: cnaeToKeyword(cnae), uf, limit },
        timeout: 8000,
      });
      const items3 = r3.data?.data || [];
      items3.forEach(c => {
        results.push({
          empresa:  c.nome || '—',
          cnpj:     formatCNPJ(c.cnpj || ''),
          cidade:   c.municipio || '—',
          uf:       c.uf || uf,
          segmento: cnaeToSeg(cnae),
          porte:    porteFromStr(c.porte || ''),
          fonte:    'ReceitaWS',
          email:    c.email || '',
          telefone: c.telefone || '',
        });
      });
    } catch(e) {
      console.log('ReceitaWS search:', e.message);
    }
  }

  return results;
}

// ── Gera leads de demonstração realistas quando APIs externas não respondem ──
function gerarLeadsMock({ cnae, uf, limit }) {
  const seg = cnaeToSeg(cnae);
  const cidades = {
    RS: ['Porto Alegre','Caxias do Sul','Pelotas','Santa Maria','Novo Hamburgo','São Leopoldo','Passo Fundo'],
    SC: ['Florianópolis','Joinville','Blumenau','Chapecó','Itajaí','Criciúma','Lages'],
    PR: ['Curitiba','Londrina','Maringá','Ponta Grossa','Cascavel','Foz do Iguaçu','Guarapuava'],
    SP: ['São Paulo','Campinas','Ribeirão Preto','Santos','São Bernardo','Sorocaba','Osasco'],
  };
  const nomesBase = {
    Distribuidor: ['Distribuidora','Atacado','Comércio','Suprimentos','Logística'],
    Importador:   ['Importadora','Trading','Internacional','Global','Import'],
    Indústria:    ['Indústria','Fábrica','Manufatura','Produtos','Confecções'],
    Varejo:       ['Loja','Comércio','Varejo','Store','Mercado'],
  };
  const produtos = {
    '4649': 'Art. Domésticos','4644': 'Farmacêuticos','4645': 'Eletroeletrônicos',
    '4642': 'Vestuário','4631': 'Alimentos','4659': 'Equipamentos',
  };
  const cidadeList = cidades[uf] || cidades['RS'];
  const prefList = nomesBase[seg] || ['Empresa'];
  const sufList = ['Sul','Norte','Brasil','RS','Prime','Max','Plus','Total','Express','Master'];
  const prod = produtos[String(cnae).slice(0,4)] || 'Produtos';

  const leads = [];
  for (let i = 0; i < limit; i++) {
    const pref = prefList[i % prefList.length];
    const suf = sufList[i % sufList.length];
    const cidade = cidadeList[i % cidadeList.length];
    const num = String(Math.floor(Math.random()*90+10));
    const cnpjFake = `${num}.${Math.floor(Math.random()*900+100)}.${Math.floor(Math.random()*900+100)}/0001-${Math.floor(Math.random()*90+10)}`;
    leads.push({
      empresa:  `${pref} ${prod} ${suf} ${i+1 > 1 ? num : ''}`.trim(),
      cnpj:     cnpjFake,
      cidade,
      uf,
      segmento: seg,
      porte:    ['Micro','Pequeno','Médio'][i % 3],
      fonte:    '📋 Demonstração (APIs externas indisponíveis)',
      email:    '',
      telefone: '',
      demo:     true,
    });
  }
  return leads;
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function formatCNPJ(s) {
  const d = s.replace(/\D/g,'');
  if (d.length !== 14) return s || '—';
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function cnaeToSeg(cnae) {
  const s = String(cnae||'');
  if (s.startsWith('464')||s.startsWith('463')||s.startsWith('465')) return 'Distribuidor';
  if (s.startsWith('51')) return 'Importador';
  if (s.startsWith('471')||s.startsWith('472')||s.startsWith('476')) return 'Varejo';
  if (s.startsWith('10')||s.startsWith('22')||s.startsWith('32')) return 'Indústria';
  return 'Distribuidor';
}

function cnaeToKeyword(cnae) {
  const m = {'4649':'artigos domesticos','4644':'farmaceuticos','4645':'eletronicos',
             '4642':'vestuario','4631':'alimentos','4659':'equipamentos'};
  return m[String(cnae).slice(0,4)] || 'distribuidor';
}

function porteFromCapital(cap) {
  const v = parseFloat(String(cap||0).replace(/[^\d.]/g,''));
  if (!v)       return '—';
  if (v<360000) return 'Micro';
  if (v<4800000) return 'Pequeno';
  if (v<300000000) return 'Médio';
  return 'Grande';
}

function porteFromStr(s) {
  const p = (s||'').toUpperCase();
  if (p.includes('ME')||p.includes('MEI')||p.includes('01')) return 'Micro';
  if (p.includes('EPP')||p.includes('02')) return 'Pequeno';
  if (p.includes('03')||p.includes('MED')) return 'Médio';
  if (p.includes('04')||p.includes('GRA')) return 'Grande';
  return '—';
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(l => {
    const key = l.cnpj && l.cnpj !== '—' ? l.cnpj : l.empresa.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    cnaes = '4649401,4644301,4645101',
    ufs   = 'RS,SC,PR',
    limit = '50',
  } = req.query;

  const cnaeList = cnaes.split(',').map(s => s.trim()).filter(Boolean);
  const ufList   = ufs.split(',').map(s => s.trim()).filter(Boolean);
  const total    = parseInt(limit) || 50;
  const perQ     = Math.max(5, Math.ceil(total / (cnaeList.length * ufList.length)));

  let all = [];

  // Try real APIs
  for (const cnae of cnaeList) {
    for (const uf of ufList) {
      const batch = await fetchPorCNAE({ cnae, uf, limit: perQ });
      all = all.concat(batch);
    }
  }

  all = dedup(all).slice(0, total);

  // If APIs returned nothing, use demo data
  if (all.length === 0) {
    for (const cnae of cnaeList.slice(0,2)) {
      for (const uf of ufList.slice(0,2)) {
        all = all.concat(gerarLeadsMock({ cnae, uf, limit: Math.ceil(total/4) }));
      }
    }
    all = dedup(all).slice(0, total);
  }

  // Add IDs and timestamps
  all = all.map((l, i) => ({
    ...l,
    id:     Date.now() + i,
    status: 'Em qualificação',
    temperatura: '🔵 Frio',
    score:  '—',
    produto:'—',
    valor:  '—',
    origem_prosp: true,
    data:   new Date().toLocaleDateString('pt-BR'),
  }));

  res.status(200).json({
    total:     all.length,
    timestamp: new Date().toISOString(),
    demo:      all.some(l => l.demo),
    leads:     all,
  });
};
