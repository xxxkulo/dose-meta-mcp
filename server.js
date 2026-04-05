import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

const META_TOKEN = process.env.META_SYSTEM_TOKEN;
const META_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${META_VERSION}`;

// ─── Helper : appel Meta Graph API ───────────────────────────────────────────
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

// ─── Définition des outils ───────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'list_campaigns',
    description: 'Liste toutes les campagnes d\'un compte publicitaire Meta avec leur statut et budget.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta (sans le préfixe act_)' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Filtrer par statut. Par défaut ALL.' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_insights',
    description: 'Récupère les métriques de performance (dépenses, CPM, leads, clics, impressions, ROAS) pour un compte, une campagne ou un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Niveau d\'agrégation. Par défaut account.' },
        date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Période. Par défaut last_30d.' },
        entity_id: { type: 'string', description: 'ID de la campagne ou ad set (optionnel, pour filtrer)' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_adsets',
    description: 'Liste les ad sets (ensembles de publicités) d\'un compte ou d\'une campagne.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        campaign_id: { type: 'string', description: 'Filtrer par campagne (optionnel)' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Filtrer par statut. Par défaut ALL.' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_ads',
    description: 'Liste les publicités d\'un compte, d\'une campagne ou d\'un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        campaign_id: { type: 'string', description: 'Filtrer par campagne (optionnel)' },
        adset_id: { type: 'string', description: 'Filtrer par ad set (optionnel)' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Filtrer par statut' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'pause_entity',
    description: 'Met en pause une campagne, un ad set ou une publicité Meta immédiatement.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de la campagne, ad set ou publicité' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Type d\'entité' }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'resume_entity',
    description: 'Réactive une campagne, un ad set ou une publicité Meta mise en pause.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de la campagne, ad set ou publicité' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'], description: 'Type d\'entité' }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'update_budget',
    description: 'Modifie le budget journalier d\'une campagne ou d\'un ad set Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'ID de la campagne ou ad set' },
        entity_type: { type: 'string', enum: ['campaign', 'adset'], description: 'Type d\'entité' },
        daily_budget: { type: 'number', description: 'Nouveau budget journalier en centimes (ex: 1000 = 10€)' }
      },
      required: ['entity_id', 'entity_type', 'daily_budget']
    }
  },
  {
    name: 'list_custom_audiences',
    description: 'Liste les audiences personnalisées (custom, lookalike, website) d\'un compte Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' },
        subtype: { type: 'string', enum: ['CUSTOM', 'LOOKALIKE', 'WEBSITE', 'ENGAGEMENT', 'ALL'], description: 'Type d\'audience. Par défaut ALL.' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_pixel_health',
    description: 'Vérifie l\'état et les événements reçus par le pixel Meta d\'un compte.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub Meta' }
      },
      required: ['account_id']
    }
  }
];

// ─── Logique des outils ───────────────────────────────────────────────────────
async function runTool(name, args) {
  switch (name) {

    case 'list_campaigns': {
      const fields = 'id,name,status,effective_status,daily_budget,lifetime_budget,objective,start_time,stop_time';
      const params = { fields, limit: 100 };
      if (args.status && args.status !== 'ALL') {
        params.effective_status = JSON.stringify([args.status]);
      }
      const data = await meta(`/act_${args.account_id}/campaigns`, 'GET', null, params);
      return data.data || [];
    }

    case 'get_insights': {
      const fields = 'campaign_name,adset_name,spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values';
      const level = args.level || 'account';
      const date_preset = args.date_preset || 'last_30d';
      let path = `/act_${args.account_id}/insights`;
      if (args.entity_id && level !== 'account') {
        path = `/${args.entity_id}/insights`;
      }
      const data = await meta(path, 'GET', null, { fields, level, date_preset, limit: 100 });
      return data.data || [];
    }

    case 'list_adsets': {
      const fields = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time';
      const params = { fields, limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.status && args.status !== 'ALL') {
        params.effective_status = JSON.stringify([args.status]);
      }
      const data = await meta(`/act_${args.account_id}/adsets`, 'GET', null, params);
      return data.data || [];
    }

    case 'list_ads': {
      const fields = 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name,thumbnail_url},tracking_specs';
      const params = { fields, limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.adset_id) params.adset_id = args.adset_id;
      if (args.status && args.status !== 'ALL') {
        params.effective_status = JSON.stringify([args.status]);
      }
      const data = await meta(`/act_${args.account_id}/ads`, 'GET', null, params);
      return data.data || [];
    }

    case 'pause_entity': {
      const result = await meta(`/${args.entity_id}`, 'POST', { status: 'PAUSED' });
      return { success: result.success, entity_id: args.entity_id, new_status: 'PAUSED' };
    }

    case 'resume_entity': {
      const result = await meta(`/${args.entity_id}`, 'POST', { status: 'ACTIVE' });
      return { success: result.success, entity_id: args.entity_id, new_status: 'ACTIVE' };
    }

    case 'update_budget': {
      const body = { daily_budget: Math.round(args.daily_budget) };
      const result = await meta(`/${args.entity_id}`, 'POST', body);
      return { success: result.success, entity_id: args.entity_id, daily_budget: args.daily_budget };
    }

    case 'list_custom_audiences': {
      const fields = 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status';
      const params = { fields, limit: 100 };
      if (args.subtype && args.subtype !== 'ALL') params.subtype = args.subtype;
      const data = await meta(`/act_${args.account_id}/customaudiences`, 'GET', null, params);
      return data.data || [];
    }

    case 'get_pixel_health': {
      const pixels = await meta(`/act_${args.account_id}/adspixels`, 'GET', null, {
        fields: 'id,name,creation_time,last_fired_time,code',
        limit: 10
      });
      const result = [];
      for (const pixel of (pixels.data || [])) {
        const stats = await meta(`/${pixel.id}/stats`, 'GET', null, {
          start_time: Math.floor(Date.now() / 1000) - 7 * 86400,
          end_time: Math.floor(Date.now() / 1000),
          aggregation: 'event'
        });
        result.push({ ...pixel, events: stats.data || [] });
      }
      return result;
    }

    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

// ─── Création du serveur MCP ──────────────────────────────────────────────────
function createMCPServer() {
  const server = new Server(
    { name: 'dose-meta-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (!META_TOKEN) throw new Error('META_SYSTEM_TOKEN non configuré dans les variables d\'environnement Railway');
      const result = await runTool(name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Erreur : ${err.message}` }],
        isError: true
      };
    }
  });

  return server;
}

// ─── Routes Express ───────────────────────────────────────────────────────────

// Health check (pour vérifier que le serveur tourne)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'dose-meta-mcp',
    version: '1.0.0',
    tools: TOOLS.length,
    meta_token_configured: !!META_TOKEN
  });
});

// Endpoint SSE pour Claude MCP
app.get('/sse', async (req, res) => {
  const server = createMCPServer();
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  res.status(200).json({ received: true });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dose Meta MCP Server démarré sur le port ${PORT}`);
  console.log(`Health check : http://localhost:${PORT}/health`);
  console.log(`Endpoint MCP : http://localhost:${PORT}/sse`);
  console.log(`Token Meta configuré : ${!!META_TOKEN}`);
});
