// ASAP Sales Hub — Pipeline API (Redis/Vercel KV)
// GET  /api/pipeline        → lista todos os leads
// POST /api/pipeline        → salva / atualiza um lead
// DELETE /api/pipeline?id=  → remove um lead

const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL ||
  'redis://default:x0vAGpox7euzeJOsedtNcsIONcRghUM5@neopolished-cognizant-slipless-39929.db.redis.io:14540';
const KEY = 'asap:pipeline';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function getClient() {
  const client = createClient({ url: REDIS_URL });
  client.on('error', e => console.error('Redis error:', e));
  await client.connect();
  return client;
}

async function getAll(client) {
  const raw = await client.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let client;
  try {
    client = await getClient();

    // ── GET — retorna todos os leads ─────────────────────────────────────────
    if (req.method === 'GET') {
      const leads = await getAll(client);
      return res.status(200).json({ total: leads.length, leads });
    }

    // ── POST — salva ou atualiza um lead ─────────────────────────────────────
    if (req.method === 'POST') {
      const lead = req.body;
      if (!lead || !lead.empresa) {
        return res.status(400).json({ error: 'Campo empresa obrigatório' });
      }
      const leads = await getAll(client);
      const idx = leads.findIndex(l =>
        l.id === lead.id ||
        l.empresa.toLowerCase() === lead.empresa.toLowerCase()
      );
      if (idx >= 0) {
        leads[idx] = { ...leads[idx], ...lead };
      } else {
        lead.id = lead.id || Date.now();
        lead.created_at = new Date().toISOString();
        leads.unshift(lead);
      }
      await client.set(KEY, JSON.stringify(leads));
      return res.status(200).json({ ok: true, total: leads.length });
    }

    // ── DELETE — remove um lead por id ───────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      let leads = await getAll(client);
      leads = leads.filter(l => l.id !== id);
      await client.set(KEY, JSON.stringify(leads));
      return res.status(200).json({ ok: true, total: leads.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  } finally {
    if (client) await client.disconnect();
  }
};
