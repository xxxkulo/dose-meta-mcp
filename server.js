import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

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
  if (data.error) throw new Error(`Meta API: ${data.error.message} (code: ${data.error.code})`);
  return data;
}

const TOOLS = [

  // ── LECTURE ─────────────────────────────────────────────────────────────────

  {
    name: 'list_ad_accounts',
    description: 'Liste tous les comptes publicitaires accessibles avec le token.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'list_campaigns',
    description: 'Liste les campagnes d\'un compte publicitaire Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'] },
        limit: { type: 'number' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_adsets',
    description: 'Liste les ad sets d\'un compte ou d\'une campagne.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        campaign_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'] }
      },
      required: ['account_id']
    }
  },
  {
    name: 'list_ads',
    description: 'Liste les publicités d\'un compte, campagne ou ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        campaign_id: { type: 'string' },
        adset_id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'] }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_performance',
    description: 'Métriques de performance : dépenses, CPM, CPC, CTR, leads, ROAS, impressions.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'] },
        date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month', 'last_90d'] },
        entity_id: { type: 'string' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_timeseries',
    description: 'Données de performance jour par jour.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        entity_id: { type: 'string' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        start_date: { type: 'string' },
        end_date: { type: 'string' }
      },
      required: ['account_id', 'entity_id', 'entity_type']
    }
  },
  {
    name: 'list_custom_audiences',
    description: 'Liste les audiences personnalisées d\'un compte.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        subtype: { type: 'string', enum: ['CUSTOM', 'LOOKALIKE', 'WEBSITE', 'ENGAGEMENT', 'ALL'] }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_pixel_health',
    description: 'Vérifie l\'état du pixel Meta.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] }
  },
  {
    name: 'list_ad_creatives',
    description: 'Liste les créatifs publicitaires d\'un compte Meta.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_ad_images',
    description: 'Recherche les images publicitaires disponibles dans un compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, name: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_ad_videos',
    description: 'Recherche les vidéos publicitaires disponibles dans un compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, title: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_targeting',
    description: 'Recherche d\'options de ciblage : intérêts, géolocalisation, comportements.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        query: { type: 'string' },
        search_type: { type: 'string', enum: ['interests', 'geolocation', 'behaviors', 'locale'] }
      },
      required: ['account_id', 'query', 'search_type']
    }
  },
  {
    name: 'estimate_audience_size',
    description: 'Estime la taille d\'audience potentielle.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        targeting_spec: { type: 'object' },
        optimization_goal: { type: 'string' }
      },
      required: ['account_id', 'targeting_spec']
    }
  },
  {
    name: 'preview_creative',
    description: 'Génère un aperçu d\'un créatif publicitaire existant.',
    inputSchema: {
      type: 'object',
      properties: {
        creative_id: { type: 'string' },
        ad_format: { type: 'string', enum: ['DESKTOP_FEED_STANDARD', 'MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY'] }
      },
      required: ['creative_id']
    }
  },

  // ── NOUVEAU v6 : POSTS FACEBOOK / INSTAGRAM ──────────────────────────────────

  {
    name: 'list_page_posts',
    description: 'Liste les posts récents d\'une page Facebook avec leurs IDs, pour les utiliser comme créatifs publicitaires.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'ID de la page Facebook' },
        limit: { type: 'number', description: 'Nombre de posts à récupérer. Défaut: 20' }
      },
      required: ['page_id']
    }
  },

  // ── ÉCRITURE ─────────────────────────────────────────────────────────────────

  {
    name: 'change_entity_status',
    description: 'Met en pause ou réactive une campagne, ad set ou publicité.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        action: { type: 'string', enum: ['pause', 'resume'] }
      },
      required: ['entity_id', 'entity_type', 'action']
    }
  },
  {
    name: 'change_entity_budget',
    description: 'Modifie le budget journalier d\'une campagne ou ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        entity_type: { type: 'string', enum: ['campaign', 'adset'] },
        daily_budget: { type: 'number', description: 'En centimes (1000 = 10€)' },
        lifetime_budget: { type: 'number' }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'duplicate_campaign',
    description: 'Duplique une campagne Meta existante.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string' },
        new_name: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'duplicate_adset',
    description: 'Duplique un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        adset_id: { type: 'string' },
        new_name: { type: 'string' },
        target_campaign_id: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] }
      },
      required: ['adset_id']
    }
  },
  {
    name: 'duplicate_ad',
    description: 'Duplique une publicité.',
    inputSchema: {
      type: 'object',
      properties: {
        ad_id: { type: 'string' },
        new_name: { type: 'string' },
        target_adset_id: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] }
      },
      required: ['ad_id']
    }
  },
  {
    name: 'create_website_audience',
    description: 'Crée une audience basée sur les visiteurs du site web.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        retention_days: { type: 'number' },
        event_name: { type: 'string' },
        pixel_id: { type: 'string' }
      },
      required: ['account_id', 'name', 'retention_days']
    }
  },
  {
    name: 'create_lookalike_audience',
    description: 'Crée une audience lookalike.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        origin_audience_id: { type: 'string' },
        country: { type: 'string' },
        ratio: { type: 'number' }
      },
      required: ['account_id', 'name', 'origin_audience_id', 'country']
    }
  },
  {
    name: 'update_adset_targeting',
    description: 'Met à jour le ciblage d\'un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        adset_id: { type: 'string' },
        targeting: { type: 'object' }
      },
      required: ['adset_id', 'targeting']
    }
  },
  {
    name: 'create_campaign',
    description: 'Crée une nouvelle campagne Meta.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        objective: { type: 'string', enum: ['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_SALES'] },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] },
        daily_budget: { type: 'number' },
        lifetime_budget: { type: 'number' },
        special_ad_categories: { type: 'array', items: { type: 'string' } }
      },
      required: ['account_id', 'name', 'objective']
    }
  },
  {
    name: 'create_adset',
    description: 'Crée un nouvel ad set dans une campagne.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        campaign_id: { type: 'string' },
        name: { type: 'string' },
        daily_budget: { type: 'number', description: 'En centimes' },
        targeting: { type: 'object' },
        optimization_goal: { type: 'string', enum: ['OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'LINK_CLICKS', 'REACH', 'IMPRESSIONS', 'LANDING_PAGE_VIEWS', 'POST_ENGAGEMENT', 'PROFILE_VISIT'] },
        billing_event: { type: 'string', enum: ['IMPRESSIONS', 'LINK_CLICKS', 'THRUPLAY'] },
        bid_strategy: { type: 'string', enum: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'] },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] },
        start_time: { type: 'string' },
        end_time: { type: 'string' }
      },
      required: ['account_id', 'campaign_id', 'name', 'daily_budget', 'targeting', 'optimization_goal']
    }
  },

  // ── NOUVEAU v6 : create_ad_creative avec object_story_id ──────────────────────

  {
    name: 'create_ad_creative',
    description: 'Crée un créatif publicitaire. Deux modes : (1) post existant FB/IG via object_story_id, (2) nouveau créatif via image_hash ou video_id + texte.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub' },
        name: { type: 'string', description: 'Nom du créatif' },
        // ── Mode 1 : post existant (Facebook ou Instagram) ──────────────────
        object_story_id: {
          type: 'string',
          description: 'Mode post existant. Format Facebook : {page_id}_{post_id} (ex: 123456789_987654321). Format Instagram : ID du media IG. Récupère les IDs via list_page_posts.'
        },
        // ── Mode 2 : nouveau créatif from scratch ──────────────────────────
        page_id: { type: 'string', description: 'ID de la page Facebook (Mode 2 uniquement)' },
        message: { type: 'string', description: 'Texte principal (Mode 2 uniquement)' },
        link: { type: 'string', description: 'URL de destination (Mode 2 uniquement)' },
        headline: { type: 'string', description: 'Titre (Mode 2 optionnel)' },
        description: { type: 'string', description: 'Description (Mode 2 optionnel)' },
        image_hash: { type: 'string', description: 'Hash image depuis upload_ad_image (Mode 2 optionnel)' },
        video_id: { type: 'string', description: 'ID vidéo depuis upload_ad_video (Mode 2 optionnel)' },
        call_to_action_type: { type: 'string', enum: ['BOOK_TRAVEL', 'CONTACT_US', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'SUBSCRIBE', 'GET_OFFER', 'GET_QUOTE', 'BOOK_NOW', 'APPLY_NOW', 'RESERVE', 'BUY_TICKETS'] }
      },
      required: ['account_id', 'name']
    }
  },

  // ── NOUVEAU v6 : create_ad_from_post — pipeline complet en 1 appel ───────────

  {
    name: 'create_ad_from_post',
    description: 'Crée directement une publicité à partir d\'un post Facebook ou Instagram existant, en une seule opération. Crée le créatif + la pub en même temps.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID du compte pub' },
        adset_id: { type: 'string', description: 'ID de l\'ad set parent' },
        object_story_id: { type: 'string', description: 'ID du post. Format FB : {page_id}_{post_id}. Récupère via list_page_posts.' },
        ad_name: { type: 'string', description: 'Nom de la publicité' },
        creative_name: { type: 'string', description: 'Nom du créatif (optionnel, généré auto si absent)' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'], description: 'Statut initial. Défaut: PAUSED' }
      },
      required: ['account_id', 'adset_id', 'object_story_id', 'ad_name']
    }
  },

  {
    name: 'create_ad',
    description: 'Crée une publicité en associant un créatif existant à un ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        adset_id: { type: 'string' },
        creative_id: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] }
      },
      required: ['account_id', 'adset_id', 'creative_id', 'name']
    }
  },
  {
    name: 'upload_ad_image',
    description: 'Upload une image depuis une URL externe.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, image_url: { type: 'string' }, name: { type: 'string' } },
      required: ['account_id', 'image_url']
    }
  },
  {
    name: 'upload_ad_video',
    description: 'Upload une vidéo depuis une URL externe.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, video_url: { type: 'string' }, title: { type: 'string' } },
      required: ['account_id', 'video_url']
    }
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// EXÉCUTION
// ─────────────────────────────────────────────────────────────────────────────
async function runTool(name, args) {
  switch (name) {

    case 'list_ad_accounts':
      return (await meta('/me/adaccounts', 'GET', null, {
        fields: 'id,name,account_status,currency,timezone_name,spend_cap,amount_spent',
        limit: args.limit || 50
      })).data || [];

    case 'list_campaigns': {
      const params = { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective,start_time,stop_time', limit: args.limit || 100 };
      if (args.status && args.status !== 'ALL') params.effective_status = JSON.stringify([args.status]);
      return (await meta(`/act_${args.account_id}/campaigns`, 'GET', null, params)).data || [];
    }

    case 'list_adsets': {
      const params = { fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time', limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.status && args.status !== 'ALL') params.effective_status = JSON.stringify([args.status]);
      return (await meta(`/act_${args.account_id}/adsets`, 'GET', null, params)).data || [];
    }

    case 'list_ads': {
      const params = { fields: 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name,thumbnail_url}', limit: 100 };
      if (args.campaign_id) params.campaign_id = args.campaign_id;
      if (args.adset_id) params.adset_id = args.adset_id;
      if (args.status && args.status !== 'ALL') params.effective_status = JSON.stringify([args.status]);
      return (await meta(`/act_${args.account_id}/ads`, 'GET', null, params)).data || [];
    }

    case 'get_performance': {
      const level = args.level || 'campaign';
      const date_preset = args.date_preset || 'last_30d';
      const path = (args.entity_id && level !== 'account') ? `/${args.entity_id}/insights` : `/act_${args.account_id}/insights`;
      return (await meta(path, 'GET', null, {
        fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values,cost_per_action_type,website_purchase_roas',
        level, date_preset, limit: 200
      })).data || [];
    }

    case 'get_timeseries': {
      const start = args.start_date || (() => { const d = new Date(); d.setDate(d.getDate() - 31); return d.toISOString().split('T')[0]; })();
      const end = args.end_date || (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
      return (await meta(`/${args.entity_id}/insights`, 'GET', null, {
        fields: 'date_start,date_stop,spend,impressions,clicks,ctr,cpm,cpc,reach,actions,action_values',
        time_increment: 1, time_range: JSON.stringify({ since: start, until: end }),
        level: args.entity_type, limit: 90
      })).data || [];
    }

    case 'list_custom_audiences': {
      const params = { fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status', limit: 100 };
      if (args.subtype && args.subtype !== 'ALL') params.subtype = args.subtype;
      return (await meta(`/act_${args.account_id}/customaudiences`, 'GET', null, params)).data || [];
    }

    case 'get_pixel_health': {
      const pixels = await meta(`/act_${args.account_id}/adspixels`, 'GET', null, { fields: 'id,name,creation_time,last_fired_time', limit: 10 });
      const result = [];
      for (const px of (pixels.data || [])) {
        try {
          const stats = await meta(`/${px.id}/stats`, 'GET', null, {
            start_time: Math.floor(Date.now() / 1000) - 7 * 86400,
            end_time: Math.floor(Date.now() / 1000), aggregation: 'event'
          });
          result.push({ ...px, recent_events: stats.data || [] });
        } catch { result.push({ ...px, recent_events: [] }); }
      }
      return result;
    }

    case 'list_ad_creatives':
      return (await meta(`/act_${args.account_id}/adcreatives`, 'GET', null, {
        fields: 'id,name,title,body,image_url,thumbnail_url,object_story_id,object_story_spec,effective_object_story_id',
        limit: args.limit || 50
      })).data || [];

    case 'search_ad_images': {
      const params = { fields: 'hash,name,url,width,height,status,created_time', limit: args.limit || 50 };
      if (args.name) params.name = args.name;
      return (await meta(`/act_${args.account_id}/adimages`, 'GET', null, params)).data || [];
    }

    case 'search_ad_videos': {
      const params = { fields: 'id,title,description,picture,created_time,length,status', limit: args.limit || 50 };
      if (args.title) params.title = args.title;
      return (await meta(`/act_${args.account_id}/advideos`, 'GET', null, params)).data || [];
    }

    case 'search_targeting': {
      const typeMap = { interests: 'adTargetingCategory', geolocation: 'adgeolocation', behaviors: 'adTargetingCategory', locale: 'adlocale' };
      const classMap = { interests: 'interests', behaviors: 'behaviors' };
      const params = { type: typeMap[args.search_type] || 'adTargetingCategory', q: args.query, limit: 30 };
      if (classMap[args.search_type]) params.class = classMap[args.search_type];
      return (await meta('/search', 'GET', null, params)).data || [];
    }

    case 'estimate_audience_size':
      return await meta(`/act_${args.account_id}/reachestimate`, 'GET', null, {
        targeting_spec: JSON.stringify(args.targeting_spec),
        optimization_goal: args.optimization_goal || 'REACH'
      });

    case 'preview_creative':
      return (await meta(`/${args.creative_id}/previews`, 'GET', null, {
        ad_format: args.ad_format || 'MOBILE_FEED_STANDARD'
      })).data || [];

    // ── NOUVEAU v6 : list_page_posts ─────────────────────────────────────────
    case 'list_page_posts': {
      const data = await meta(`/${args.page_id}/posts`, 'GET', null, {
        fields: 'id,message,story,created_time,full_picture,permalink_url,attachments{media_type,url,description,media{image{src}}}',
        limit: args.limit || 20
      });
      // Formater pour affichage clair
      return (data.data || []).map(post => ({
        id: post.id,
        object_story_id: post.id, // déjà au format {page_id}_{post_id}
        message: post.message ? post.message.substring(0, 120) + (post.message.length > 120 ? '...' : '') : '(no text)',
        created_time: post.created_time,
        permalink_url: post.permalink_url,
        has_image: !!post.full_picture,
        media_type: post.attachments?.data?.[0]?.media_type || 'none'
      }));
    }

    // ── MISE À JOUR v6 : create_ad_creative avec object_story_id ─────────────
    case 'create_ad_creative': {
      let creativeBody = { name: args.name };

      if (args.object_story_id) {
        // Mode 1 : post existant FB ou IG
        creativeBody.object_story_id = args.object_story_id;
      } else {
        // Mode 2 : nouveau créatif from scratch
        if (!args.page_id) throw new Error('page_id requis en mode création (sans object_story_id)');
        if (!args.message) throw new Error('message requis en mode création (sans object_story_id)');
        if (!args.link) throw new Error('link requis en mode création (sans object_story_id)');

        const link_data = {
          message: args.message,
          link: args.link,
          name: args.headline || '',
          description: args.description || ''
        };
        if (args.image_hash) link_data.image_hash = args.image_hash;
        if (args.call_to_action_type) {
          link_data.call_to_action = { type: args.call_to_action_type, value: { link: args.link } };
        }

        const story_spec = { page_id: args.page_id };
        if (args.video_id) {
          story_spec.video_data = { video_id: args.video_id, message: args.message, title: args.headline || '' };
        } else {
          story_spec.link_data = link_data;
        }
        creativeBody.object_story_spec = story_spec;
      }

      const r = await meta(`/act_${args.account_id}/adcreatives`, 'POST', creativeBody);
      return { success: true, creative_id: r.id, name: args.name, mode: args.object_story_id ? 'existing_post' : 'new_creative' };
    }

    // ── NOUVEAU v6 : create_ad_from_post — pipeline complet en 1 appel ───────
    case 'create_ad_from_post': {
      // Étape 1 : créer le créatif depuis le post existant
      const creativeName = args.creative_name || `Créatif · ${args.ad_name} · ${new Date().toLocaleDateString('fr-FR')}`;
      const creativeResult = await meta(`/act_${args.account_id}/adcreatives`, 'POST', {
        name: creativeName,
        object_story_id: args.object_story_id
      });

      // Étape 2 : créer la pub en associant le créatif à l'ad set
      const adResult = await meta(`/act_${args.account_id}/ads`, 'POST', {
        name: args.ad_name,
        adset_id: args.adset_id,
        creative: { creative_id: creativeResult.id },
        status: args.status || 'PAUSED'
      });

      return {
        success: true,
        creative_id: creativeResult.id,
        creative_name: creativeName,
        ad_id: adResult.id,
        ad_name: args.ad_name,
        status: args.status || 'PAUSED',
        message: `Publicité créée depuis le post ${args.object_story_id} — statut PAUSED, à activer dans Meta Ads Manager.`
      };
    }

    case 'create_ad': {
      const r = await meta(`/act_${args.account_id}/ads`, 'POST', {
        name: args.name, adset_id: args.adset_id,
        creative: { creative_id: args.creative_id }, status: args.status || 'PAUSED'
      });
      return { success: true, ad_id: r.id, name: args.name, status: args.status || 'PAUSED' };
    }

    case 'change_entity_status': {
      const status = args.action === 'pause' ? 'PAUSED' : 'ACTIVE';
      const r = await meta(`/${args.entity_id}`, 'POST', { status });
      return { success: r.success, entity_id: args.entity_id, new_status: status };
    }

    case 'change_entity_budget': {
      const body = {};
      if (args.daily_budget) body.daily_budget = Math.round(args.daily_budget);
      if (args.lifetime_budget) body.lifetime_budget = Math.round(args.lifetime_budget);
      const r = await meta(`/${args.entity_id}`, 'POST', body);
      return { success: r.success, entity_id: args.entity_id, ...body };
    }

    case 'duplicate_campaign': {
      const body = { status: args.status || 'PAUSED' };
      if (args.new_name) body.name = args.new_name;
      const r = await meta(`/${args.campaign_id}/copies`, 'POST', body);
      return { success: true, new_campaign_id: r.copied_campaign_id, status: args.status || 'PAUSED' };
    }

    case 'duplicate_adset': {
      const body = { status: args.status || 'PAUSED', deep_copy: true };
      if (args.target_campaign_id) body.campaign_id = args.target_campaign_id;
      const r = await meta(`/${args.adset_id}/copies`, 'POST', body);
      return { success: true, new_adset_id: r.copied_adset_id, status: args.status || 'PAUSED' };
    }

    case 'duplicate_ad': {
      const body = { status: args.status || 'PAUSED' };
      if (args.target_adset_id) body.adset_id = args.target_adset_id;
      const r = await meta(`/${args.ad_id}/copies`, 'POST', body);
      return { success: true, new_ad_id: r.copied_ad_id, status: args.status || 'PAUSED' };
    }

    case 'create_website_audience': {
      const pixels = await meta(`/act_${args.account_id}/adspixels`, 'GET', null, { fields: 'id', limit: 1 });
      const pixel_id = args.pixel_id || pixels.data?.[0]?.id;
      if (!pixel_id) throw new Error('Aucun pixel trouvé sur ce compte');
      const rule = args.event_name
        ? JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixel_id, type: 'pixel' }], retention_seconds: args.retention_days * 86400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: args.event_name }] } }] } })
        : JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixel_id, type: 'pixel' }], retention_seconds: args.retention_days * 86400 }] } });
      const r = await meta(`/act_${args.account_id}/customaudiences`, 'POST', {
        name: args.name, subtype: 'WEBSITE', rule, prefill: true
      });
      return { success: true, audience_id: r.id, name: args.name };
    }

    case 'create_lookalike_audience': {
      const r = await meta(`/act_${args.account_id}/customaudiences`, 'POST', {
        name: args.name, subtype: 'LOOKALIKE',
        origin_audience_id: args.origin_audience_id,
        lookalike_spec: JSON.stringify({ type: 'similarity', ratio: args.ratio || 0.01, country: args.country })
      });
      return { success: true, audience_id: r.id, name: args.name };
    }

    case 'update_adset_targeting': {
      const r = await meta(`/${args.adset_id}`, 'POST', { targeting: args.targeting });
      return { success: r.success, adset_id: args.adset_id };
    }

    case 'create_campaign': {
      const body = {
        name: args.name, objective: args.objective,
        status: args.status || 'PAUSED',
        special_ad_categories: args.special_ad_categories || []
      };
      if (args.daily_budget) body.daily_budget = Math.round(args.daily_budget);
      if (args.lifetime_budget) body.lifetime_budget = Math.round(args.lifetime_budget);
      const r = await meta(`/act_${args.account_id}/campaigns`, 'POST', body);
      return { success: true, campaign_id: r.id, name: args.name, status: args.status || 'PAUSED' };
    }

    case 'create_adset': {
      const body = {
        name: args.name, campaign_id: args.campaign_id,
        daily_budget: Math.round(args.daily_budget),
        targeting: args.targeting,
        optimization_goal: args.optimization_goal,
        billing_event: args.billing_event || 'IMPRESSIONS',
        bid_strategy: args.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
        status: args.status || 'PAUSED'
      };
      if (args.start_time) body.start_time = args.start_time;
      if (args.end_time) body.end_time = args.end_time;
      const r = await meta(`/act_${args.account_id}/adsets`, 'POST', body);
      return { success: true, adset_id: r.id, name: args.name, status: args.status || 'PAUSED' };
    }

    case 'upload_ad_image': {
      const r = await meta(`/act_${args.account_id}/adimages`, 'POST', {
        url: args.image_url, name: args.name || 'uploaded_image'
      });
      const first = Object.values(r.images || {})[0];
      return { success: true, hash: first?.hash, url: first?.url };
    }

    case 'upload_ad_video': {
      const r = await meta(`/act_${args.account_id}/advideos`, 'POST', {
        file_url: args.video_url, title: args.title || 'uploaded_video'
      });
      return { success: true, video_id: r.id, title: args.title };
    }

    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVEUR MCP
// ─────────────────────────────────────────────────────────────────────────────
function createMCPServer() {
  const server = new Server(
    { name: 'dose-meta-mcp', version: '6.0.0' },
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'dose-meta-mcp', version: '6.0.0', tools: TOOLS.length, meta_token: !!META_TOKEN });
});

app.all('/mcp', async (req, res) => {
  try {
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => server.close());
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dose Meta MCP v6.0 — ${TOOLS.length} outils — port ${PORT}`);
  console.log(`Token: ${META_TOKEN ? 'OK' : 'MANQUANT'}`);
});
