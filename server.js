import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const META_TOKEN = process.env.META_SYSTEM_TOKEN;
const META_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${META_VERSION}`;

async function meta(path, method = 'GET', body = null, extraParams = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('access_token', META_TOKEN);
  for (const [k, v] of Object.entries(extraParams)) {
    url.searchParams.set(k, String(v));
  }
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  const data = await res.json();
  if (data.error) throw new Error(`Meta API: ${data.error.message}`);
  return data;
}

const TOOLS = [
  {
    name: 'list_campaigns',
    description: 'Liste toutes les campagnes d\'un compte publicitaire Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta (sans act_)' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Statut. Défaut: ALL' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_insights',
    description: 'Métriques de performance : dépenses, CPM, leads, clics, impressions.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Niveau. Défaut: account' },
        date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Période. Défaut: last_30d' },
        entity_id: { type: 'string', description: 'ID campagne ou adset (optionnel)' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_adsets',
    description: 'Liste les ad sets d\'un compte ou d\'une campagne Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        campaign_id: { type: 'string', description: 'Filtrer par campagne (optionnel)' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Statut. Défaut: ALL' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_ads',
    description: 'Liste les publicités d\'un compte, campagne ou ad set Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        campaign_id: { type: 'string', description: 'Filtrer par campagne (optionnel)' },
        adset_id: { type: 'string', description: 'Filtrer par ad set (optionnel)' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'pause_entity',
    description: 'Met en pause une campagne, ad set ou publicité Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de l\'entité' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'resume_entity',
    description: 'Réactive une campagne, ad set ou publicité Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de l\'entité' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'update_budget',
    description: 'Modifie le budget journalier d\'une campagne ou d\'un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de l\'entité' },
        entity_type: { type: 'string', enum: ['campaign', 'adset'] },
        daily_budget: { type: 'number', description: 'Nouveau budget en centimes (1000 = 10€)' }
      },
      required: ['entity_id', 'entity_type', 'daily_budget']
    }
  },
  {
    name: 'list_custom_audiences',
    description: 'Liste les audiences personnalisées d\'un compte Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        subtype: { type: 'string', enum: ['CUSTOM', 'LOOKALIKE', 'WEBSITE', 'ENGAGEMENT', 'ALL'] }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_pixel_health',
    description: 'Vérifie l\'état du pixel Meta d\'un compte.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' }
      },
      required: ['account_id']
    }
  }
];

async function runTool(name, args) {
  switch (name) {
    case 'list_campaigns': {
      const params = { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective', limit: 100 };
      if (args.status && args.status !== 'ALL') params.effective_status = JSON.stringify([args.status]);
      return (await meta(`/act_${args.account_id}/campaigns`, 'GET', null, params)).data || [];
    }
    case 'get_insights': {
      const level = args.level || 'account';
      const date_preset = args.date_preset || 'last_30d';
      const path = (args.entity_id && level !== 'account') ? `/${args.entity_id}/insights` : `/act_${args.account_id}/insights`;
      return (await meta(path, 'GET', null, {
        fields: 'campaign_name,adset_name,spend,impressions,clicks,ctr,cpm,cpc,reach,actions,action_values',
        level, date_preset, limit: 100
      })).data || [];
    }
    case 'list_adsets': {
      const params = { fields: 'id,name,campaign_id,status,effective_status,daily_budget,targeting,optimization_goal', limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.status && args.status !== 'ALL') params.effective_status = JSON.stringify([args.status]);
      return (await meta(`/act_${args.account_id}/adsets`, 'GET', null, params)).data || [];
    }
    case 'list_ads': {
      const params = { fields: 'id,name,adset_id,campaign_id,status,effective_status', limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.adset_id) params.adset_id = args.adset_id;
      return (await meta(`/act_${args.account_id}/ads`, 'GET', null, params)).data || [];
    }
    case 'pause_entity': {
      const r = await meta(`/${args.entity_id}`, 'POST', { status: 'PAUSED' });
      return { success: r.success, entity_id: args.entity_id, new_status: 'PAUSED' };
    }
    case 'resume_entity': {
      const r = await meta(`/${args.entity_id}`, 'POST', { status: 'ACTIVE' });
      return { success: r.success, entity_id: args.entity_id, new_status: 'ACTIVE' };
    }
    case 'update_budget': {
      const r = await meta(`/${args.entity_id}`, 'POST', { daily_budget: Math.round(args.daily_budget) });
      return { success: r.success, entity_id: args.entity_id, daily_budget: args.daily_budget };
    }
    case 'list_custom_audiences': {
      const params = { fields: 'id,name,subtype,approximate_count_lower_bound', limit: 100 };
      if (args.subtype && args.subtype !== 'ALL') params.subtype = args.subtype;
      return (await meta(`/act_${args.account_id}/customaudiences`, 'GET', null, params)).data || [];
    }
    case 'get_pixel_health': {
      return (await meta(`/act_${args.account_id}/adspixels`, 'GET', null, {
        fields: 'id,name,last_fired_time', limit: 10
      })).data || [];
    }
    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

function createMCPServer() {
  const server = new Server(
    { name: 'dose-meta-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (!META_TOKEN) throw new Error('META_SYSTEM_TOKEN manquant dans les variables Render');
      const result = await runTool(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Erreur: ${err.message}` }], isError: true };
    }
  });
  return server;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'dose-meta-mcp', tools: TOOLS.length, meta_token: !!META_TOKEN });
});

// Endpoint MCP unique — nouveau protocole Streamable HTTP
app.all('/mcp', async (req, res) => {
  try {
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => server.close());
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dose Meta MCP v3 démarré — port ${PORT}`);
  console.log(`Health : http://localhost:${PORT}/health`);
  console.log(`MCP    : http://localhost:${PORT}/mcp`);
  console.log(`Token  : ${META_TOKEN ? 'OK' : 'MANQUANT'}`);
});
