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

// Cache des Page Access Tokens (page_id â token)
const PAGE_TOKEN_CACHE = {};

// Appel API avec System User Token (ads, insights)
async function meta(path, method = 'GET', body = null, extraParams = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('access_token', META_TOKEN);
  for (const [k, v] of Object.entries(extraParams)) {
    url.searchParams.set(k, String(v));
  }

  let opts;
  if (body && method !== 'GET') {
    // Meta Marketing API attend du form-encoded pour les POST, pas du JSON
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) || (typeof v === 'object')) {
        form.set(k, JSON.stringify(v));
      } else {
        form.set(k, String(v));
      }
    }
    opts = {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    };
  } else {
    opts = { method };
  }

  const res = await fetch(url.toString(), opts);
  const data = await res.json();
  if (data.error) throw new Error(`Meta API: ${data.error.message} (code: ${data.error.code})`);
  return data;
}

// RÃ©cupÃ¨re le Page Access Token pour un page_id donnÃ© (auto-Ã©change via System User Token)
async function getPageToken(page_id) {
  if (PAGE_TOKEN_CACHE[page_id]) return PAGE_TOKEN_CACHE[page_id];
  const url = new URL(`${BASE}/${page_id}`);
  url.searchParams.set('fields', 'access_token');
  url.searchParams.set('access_token', META_TOKEN);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`Page token error: ${data.error.message}. VÃ©rifiez que le System User est admin de la page.`);
  if (!data.access_token) throw new Error(`Impossible d'obtenir le Page Access Token pour la page ${page_id}. Le System User doit Ãªtre ajoutÃ© comme admin de la page Facebook.`);
  PAGE_TOKEN_CACHE[page_id] = data.access_token;
  return data.access_token;
}

// Appel API avec Page Access Token (posts, photos, vidÃ©os, insights de page)
async function metaPage(page_id, path, method = 'GET', body = null, extraParams = {}) {
  const token = await getPageToken(page_id);
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(extraParams)) {
    url.searchParams.set(k, String(v));
  }

  let opts;
  if (body && method !== 'GET') {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) || (typeof v === 'object')) {
        form.set(k, JSON.stringify(v));
      } else {
        form.set(k, String(v));
      }
    }
    opts = {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    };
  } else {
    opts = { method };
  }

  const res = await fetch(url.toString(), opts);
  const data = await res.json();
  if (data.error) throw new Error(`Meta Page API: ${data.error.message} (code: ${data.error.code})`);
  return data;
}

const TOOLS = [

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // BLOC 1 â LECTURE META ADS
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  {
    name: 'list_ad_accounts',
    description: 'Liste tous les comptes publicitaires accessibles.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'list_campaigns',
    description: 'Liste les campagnes d\'un compte pub Meta.',
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
    description: 'Liste les publicitÃ©s d\'un compte, campagne ou ad set.',
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
    description: 'MÃ©triques de performance : spend, CPM, CPC, CTR, leads, ROAS.',
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
    description: 'Performance jour par jour pour une campagne, ad set ou pub.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        entity_id: { type: 'string' },
        entity_type: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['account_id', 'entity_id', 'entity_type']
    }
  },
  {
    name: 'list_custom_audiences',
    description: 'Liste les audiences personnalisÃ©es d\'un compte.',
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
    description: 'VÃ©rifie l\'Ã©tat du pixel Meta et ses Ã©vÃ©nements rÃ©cents.',
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] }
  },
  {
    name: 'list_ad_creatives',
    description: 'Liste les crÃ©atifs publicitaires d\'un compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_ad_images',
    description: 'Recherche les images disponibles dans la bibliothÃ¨que du compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, name: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_ad_videos',
    description: 'Recherche les vidÃ©os disponibles dans la bibliothÃ¨que du compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, title: { type: 'string' }, limit: { type: 'number' } },
      required: ['account_id']
    }
  },
  {
    name: 'search_targeting',
    description: 'Recherche des options de ciblage : intÃ©rÃªts, gÃ©olocalisation, comportements.',
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
    description: 'Estime la taille d\'audience avant de crÃ©er un ad set.',
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
    description: 'GÃ©nÃ¨re un aperÃ§u HTML d\'un crÃ©atif existant.',
    inputSchema: {
      type: 'object',
      properties: {
        creative_id: { type: 'string' },
        ad_format: { type: 'string', enum: ['DESKTOP_FEED_STANDARD', 'MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY'] }
      },
      required: ['creative_id']
    }
  },

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // BLOC 2 â CONTENUS FACEBOOK PAGE (AUTONOMIE CRÃATIFS)
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  {
    name: 'list_page_posts',
    description: 'Liste les posts rÃ©cents d\'une page Facebook avec leurs IDs et mÃ©triques de base. Utilise les IDs pour crÃ©er des publicitÃ©s via create_ad_from_post.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'ID de la page Facebook' },
        limit: { type: 'number', description: 'Nombre de posts. DÃ©faut: 25' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'list_page_videos',
    description: 'Liste les vidÃ©os publiÃ©es sur une page Facebook. IdÃ©al pour identifier des reels/vidÃ©os performants Ã  utiliser en pub.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        limit: { type: 'number', description: 'DÃ©faut: 20' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'list_page_photos',
    description: 'Liste les photos publiÃ©es sur une page Facebook.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        limit: { type: 'number', description: 'DÃ©faut: 20' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'get_post_insights',
    description: 'RÃ©cupÃ¨re les mÃ©triques d\'un post Facebook spÃ©cifique : reach, impressions, engagement, clics, vues vidÃ©o. Permet de sÃ©lectionner automatiquement les meilleurs posts pour les pubs.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'ID du post (format: page_id_post_id)' }
      },
      required: ['post_id']
    }
  },
  {
    name: 'get_best_posts_for_ads',
    description: 'Analyse automatiquement les N derniers posts d\'une page et retourne les meilleurs classÃ©s par engagement pour un objectif donnÃ© (rÃ©servation, notoriÃ©tÃ©, trafic). Outil clÃ© pour l\'autonomie crÃ©ative.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'ID de la page Facebook' },
        objective: { type: 'string', enum: ['reservation', 'awareness', 'traffic', 'engagement'], description: 'Objectif publicitaire pour adapter le scoring' },
        limit: { type: 'number', description: 'Nombre de posts Ã  analyser. DÃ©faut: 20' },
        top_n: { type: 'number', description: 'Nombre de meilleurs posts Ã  retourner. DÃ©faut: 5' }
      },
      required: ['page_id', 'objective']
    }
  },

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // BLOC 3 â CONTENUS INSTAGRAM BUSINESS (AUTONOMIE CRÃATIFS IG)
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  {
    name: 'get_instagram_account',
    description: 'RÃ©cupÃ¨re l\'ID du compte Instagram Business liÃ© Ã  une page Facebook. NÃ©cessaire pour accÃ©der aux posts Instagram.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'ID de la page Facebook' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'list_instagram_posts',
    description: 'Liste les posts et reels rÃ©cents du compte Instagram Business liÃ© Ã  la page. Inclut type de mÃ©dia, URL, lÃ©gende, timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        ig_user_id: { type: 'string', description: 'ID du compte Instagram Business (depuis get_instagram_account)' },
        limit: { type: 'number', description: 'Nombre de posts. DÃ©faut: 20' },
        media_type: { type: 'string', enum: ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'ALL'], description: 'Filtrer par type. DÃ©faut: ALL' }
      },
      required: ['ig_user_id']
    }
  },
  {
    name: 'get_instagram_post_insights',
    description: 'MÃ©triques d\'un post Instagram : reach, impressions, engagement, vues vidÃ©o, saves, shares. Pour sÃ©lectionner les meilleurs contenus IG Ã  booster.',
    inputSchema: {
      type: 'object',
      properties: {
        ig_media_id: { type: 'string', description: 'ID du media Instagram (depuis list_instagram_posts)' }
      },
      required: ['ig_media_id']
    }
  },
  {
    name: 'get_best_instagram_posts_for_ads',
    description: 'Analyse automatiquement les N derniers posts Instagram et retourne les meilleurs classÃ©s par performance pour un objectif donnÃ©.',
    inputSchema: {
      type: 'object',
      properties: {
        ig_user_id: { type: 'string', description: 'ID du compte Instagram Business' },
        objective: { type: 'string', enum: ['reservation', 'awareness', 'traffic', 'engagement'] },
        limit: { type: 'number', description: 'Posts Ã  analyser. DÃ©faut: 20' },
        top_n: { type: 'number', description: 'Meilleurs posts Ã  retourner. DÃ©faut: 5' }
      },
      required: ['ig_user_id', 'objective']
    }
  },

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // BLOC 4 â ÃCRITURE META ADS (CRÃATION COMPLÃTE)
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  {
    name: 'create_campaign',
    description: 'CrÃ©e une nouvelle campagne Meta. Statut PAUSED par dÃ©faut.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        objective: { type: 'string', enum: ['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_SALES'] },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] },
        daily_budget: { type: 'number', description: 'En centimes (2000 = 20â¬)' },
        lifetime_budget: { type: 'number' },
        special_ad_categories: { type: 'array', items: { type: 'string' } }
      },
      required: ['account_id', 'name', 'objective']
    }
  },
  {
    name: 'create_adset',
    description: 'CrÃ©e un ad set dans une campagne avec ciblage, budget et optimisation.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        campaign_id: { type: 'string' },
        name: { type: 'string' },
        daily_budget: { type: 'number', description: 'En centimes (2000 = 20â¬)' },
        targeting: { type: 'object', description: 'Spec de ciblage Meta (geo_locations, age_min, age_max, interests...)' },
        optimization_goal: { type: 'string', enum: ['OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'LINK_CLICKS', 'REACH', 'IMPRESSIONS', 'LANDING_PAGE_VIEWS', 'POST_ENGAGEMENT', 'PROFILE_VISIT'] },
        destination_type: { type: 'string', enum: ['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'APP', 'ON_AD'], description: 'Requis Meta API v17+. Default: FACEBOOK' },
        billing_event: { type: 'string', enum: ['IMPRESSIONS', 'LINK_CLICKS', 'THRUPLAY'] },
        bid_strategy: { type: 'string', enum: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'] },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] },
        start_time: { type: 'string' },
        end_time: { type: 'string' }
      },
      required: ['account_id', 'campaign_id', 'name', 'daily_budget', 'targeting', 'optimization_goal']
    }
  },
  {
    name: 'create_ad_creative',
    description: 'CrÃ©e un crÃ©atif pub. Mode 1: post existant via object_story_id. Mode 2: nouveau crÃ©atif image/vidÃ©o + texte.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        object_story_id: { type: 'string', description: 'Mode post existant. Format: {page_id}_{post_id}. RÃ©cupÃ©rÃ© via list_page_posts ou get_best_posts_for_ads.' },
        page_id: { type: 'string', description: 'Mode 2 uniquement' },
        message: { type: 'string', description: 'Texte principal (Mode 2)' },
        link: { type: 'string', description: 'URL destination (Mode 2)' },
        headline: { type: 'string' },
        description: { type: 'string' },
        image_hash: { type: 'string', description: 'Hash depuis upload_ad_image' },
        video_id: { type: 'string', description: 'ID depuis upload_ad_video' },
        call_to_action_type: { type: 'string', enum: ['BOOK_TRAVEL', 'CONTACT_US', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'SUBSCRIBE', 'GET_OFFER', 'GET_QUOTE', 'BOOK_NOW', 'APPLY_NOW', 'RESERVE', 'BUY_TICKETS'] }
      },
      required: ['account_id', 'name']
    }
  },
  {
    name: 'create_ad',
    description: 'CrÃ©e une pub en associant un crÃ©atif Ã  un ad set.',
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
    name: 'create_ad_from_post',
    description: 'Pipeline complet en 1 appel : crÃ©e crÃ©atif + pub depuis un post FB existant. IdÃ©al aprÃ¨s get_best_posts_for_ads.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        adset_id: { type: 'string' },
        object_story_id: { type: 'string', description: 'Format: {page_id}_{post_id}' },
        ad_name: { type: 'string' },
        creative_name: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'] }
      },
      required: ['account_id', 'adset_id', 'object_story_id', 'ad_name']
    }
  },
  {
    name: 'create_full_campaign',
    description: 'Pipeline ultra-complet en 1 appel : crÃ©e campagne + ad set + crÃ©atif depuis post existant + pub. Autonomie totale en une seule opÃ©ration.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'ID compte pub' },
        campaign_name: { type: 'string' },
        campaign_objective: { type: 'string', enum: ['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES'] },
        adset_name: { type: 'string' },
        daily_budget_cents: { type: 'number', description: 'Budget journalier en centimes (ex: 2000 = 20â¬)' },
        targeting: { type: 'object', description: 'Spec de ciblage complet (geo_locations requis)' },
        optimization_goal: { type: 'string', enum: ['OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'LINK_CLICKS', 'REACH', 'LANDING_PAGE_VIEWS', 'POST_ENGAGEMENT'] },
        object_story_id: { type: 'string', description: 'Post existant FB/IG Ã  utiliser comme crÃ©atif. Format: {page_id}_{post_id}' },
        ad_name: { type: 'string' },
        status: { type: 'string', enum: ['PAUSED', 'ACTIVE'], description: 'DÃ©faut: PAUSED' }
      },
      required: ['account_id', 'campaign_name', 'campaign_objective', 'adset_name', 'daily_budget_cents', 'targeting', 'optimization_goal', 'object_story_id', 'ad_name']
    }
  },
  {
    name: 'change_entity_status',
    description: 'Pause ou rÃ©active une campagne, ad set ou pub.',
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
    description: 'Modifie le budget journalier ou total d\'une campagne ou ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        entity_type: { type: 'string', enum: ['campaign', 'adset'] },
        daily_budget: { type: 'number', description: 'En centimes' },
        lifetime_budget: { type: 'number', description: 'En centimes' }
      },
      required: ['entity_id', 'entity_type']
    }
  },
  {
    name: 'duplicate_campaign',
    description: 'Duplique une campagne Meta.',
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
    description: 'Duplique un ad set, optionnellement dans une autre campagne.',
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
    description: 'Duplique une publicitÃ©, optionnellement dans un autre ad set.',
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
    name: 'update_adset_targeting',
    description: 'Met Ã  jour le ciblage d\'un ad set existant.',
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
    name: 'create_website_audience',
    description: 'CrÃ©e une audience website custom basÃ©e sur le pixel.',
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
    description: 'CrÃ©e une audience lookalike depuis une audience source.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        name: { type: 'string' },
        origin_audience_id: { type: 'string' },
        country: { type: 'string' },
        ratio: { type: 'number', description: '0.01 = 1%, max 0.20' }
      },
      required: ['account_id', 'name', 'origin_audience_id', 'country']
    }
  },
  {
    name: 'upload_ad_image',
    description: 'Upload une image depuis une URL publique vers la bibliothÃ¨que du compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, image_url: { type: 'string' }, name: { type: 'string' } },
      required: ['account_id', 'image_url']
    }
  },
  {
    name: 'upload_ad_video',
    description: 'Upload une vidÃ©o depuis une URL publique vers la bibliothÃ¨que du compte.',
    inputSchema: {
      type: 'object',
      properties: { account_id: { type: 'string' }, video_url: { type: 'string' }, title: { type: 'string' } },
      required: ['account_id', 'video_url']
    }
  }
];

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// HELPERS
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function scorePostForObjective(post, objective) {
  const actions = post.insights?.data || [];
  const getValue = (type) => {
    const a = actions.find(x => x.name === type);
    return a ? parseInt(a.values?.[0]?.value || 0) : 0;
  };
  const reach = getValue('post_impressions_unique');
  const engagement = getValue('post_engaged_users');
  const clicks = getValue('post_clicks');
  const videoViews = getValue('post_video_views');
  const reactions = getValue('post_reactions_by_type_total');

  const engagementRate = reach > 0 ? engagement / reach : 0;

  switch (objective) {
    case 'reservation':
      // Score rÃ©servation : privilÃ©gie engagement + clics (intent)
      return engagementRate * 40 + clicks * 0.3 + reach * 0.001;
    case 'awareness':
      // Score notoriÃ©tÃ© : privilÃ©gie reach + vues vidÃ©o
      return reach * 0.01 + videoViews * 0.005;
    case 'traffic':
      // Score trafic : privilÃ©gie clics
      return clicks * 2 + engagementRate * 20;
    case 'engagement':
    default:
      return engagementRate * 50 + reactions * 0.1;
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// EXÃCUTION OUTILS
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function runTool(name, args) {
  switch (name) {

    // ââ ADS LECTURE ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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
        fields: 'id,name,title,body,image_url,thumbnail_url,object_story_id,object_story_spec',
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

    // ââ CONTENUS FACEBOOK PAGE âââââââââââââââââââââââââââââââââââââââââââââââ

    case 'list_page_posts': {
      const data = await metaPage(args.page_id, `/${args.page_id}/posts`, 'GET', null, {
        fields: 'id,message,story,created_time,full_picture,permalink_url,attachments{media_type,url,description,media{image{src}}},shares,likes.summary(true)',
        limit: args.limit || 25
      });
      return (data.data || []).map(post => ({
        id: post.id,
        object_story_id: post.id,
        message: (post.message || post.story || '').substring(0, 150),
        created_time: post.created_time,
        permalink_url: post.permalink_url,
        media_type: post.attachments?.data?.[0]?.media_type || 'text',
        has_image: !!post.full_picture,
        likes: post.likes?.summary?.total_count || 0,
        shares: post.shares?.count || 0
      }));
    }

    case 'list_page_videos': {
      const data = await metaPage(args.page_id, `/${args.page_id}/videos`, 'GET', null, {
        fields: 'id,title,description,created_time,length,picture,permalink_url,views,likes.summary(true)',
        limit: args.limit || 20
      });
      return (data.data || []).map(v => ({
        id: v.id,
        title: v.title || '(sans titre)',
        description: (v.description || '').substring(0, 100),
        created_time: v.created_time,
        length_seconds: v.length,
        views: v.views || 0,
        likes: v.likes?.summary?.total_count || 0,
        permalink_url: v.permalink_url,
        thumbnail: v.picture
      }));
    }

    case 'list_page_photos': {
      const data = await metaPage(args.page_id, `/${args.page_id}/photos`, 'GET', null, {
        fields: 'id,name,created_time,link,images,likes.summary(true)',
        limit: args.limit || 20,
        type: 'uploaded'
      });
      return (data.data || []).map(p => ({
        id: p.id,
        caption: (p.name || '').substring(0, 100),
        created_time: p.created_time,
        link: p.link,
        likes: p.likes?.summary?.total_count || 0,
        url: p.images?.[0]?.source
      }));
    }

    case 'get_post_insights': {
      const metrics = [
        'post_impressions', 'post_impressions_unique',
        'post_engaged_users', 'post_clicks',
        'post_reactions_by_type_total', 'post_video_views'
      ].join(',');
      try {
        const page_id = args.post_id.split('_')[0];
        const data = await metaPage(page_id, `/${args.post_id}/insights`, 'GET', null, { metric: metrics });
        const result = {};
        for (const item of (data.data || [])) {
          result[item.name] = item.values?.[0]?.value || 0;
        }
        return result;
      } catch {
        return { error: 'Insights non disponibles pour ce post' };
      }
    }

    case 'get_best_posts_for_ads': {
      const limit = args.limit || 20;
      const topN = args.top_n || 5;

      const postsData = await metaPage(args.page_id, `/${args.page_id}/posts`, 'GET', null, {
        fields: 'id,message,story,created_time,full_picture,permalink_url,attachments{media_type},shares,likes.summary(true)',
        limit
      });
      const posts = postsData.data || [];

      const metrics = 'post_impressions_unique,post_engaged_users,post_clicks,post_video_views,post_reactions_by_type_total';
      const withInsights = await Promise.all(posts.map(async (post) => {
        try {
          const ins = await metaPage(args.page_id, `/${post.id}/insights`, 'GET', null, { metric: metrics });
          const values = {};
          for (const item of (ins.data || [])) {
            values[item.name] = typeof item.values?.[0]?.value === 'object'
              ? Object.values(item.values[0].value).reduce((a, b) => a + b, 0)
              : parseInt(item.values?.[0]?.value || 0);
          }
          return { ...post, insights: { data: ins.data || [] }, _metrics: values };
        } catch {
          return { ...post, _metrics: {} };
        }
      }));

      // 3. Scorer et trier
      const scored = withInsights.map(post => ({
        id: post.id,
        object_story_id: post.id,
        message: (post.message || post.story || '').substring(0, 150),
        created_time: post.created_time,
        permalink_url: post.permalink_url,
        media_type: post.attachments?.data?.[0]?.media_type || 'text',
        has_image: !!post.full_picture,
        reach: post._metrics.post_impressions_unique || 0,
        engaged_users: post._metrics.post_engaged_users || 0,
        clicks: post._metrics.post_clicks || 0,
        video_views: post._metrics.post_video_views || 0,
        reactions: post._metrics.post_reactions_by_type_total || 0,
        shares: post.shares?.count || 0,
        likes: post.likes?.summary?.total_count || 0,
        engagement_rate: (post._metrics.post_impressions_unique || 0) > 0
          ? ((post._metrics.post_engaged_users || 0) / post._metrics.post_impressions_unique * 100).toFixed(2) + '%'
          : 'N/A',
        score: scorePostForObjective({ insights: { data: (post._metrics && []) || [] }, ...post }, args.objective),
        recommendation: ''
      }));

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, topN);

      // 4. Ajouter recommandations
      top.forEach((p, i) => {
        if (i === 0) p.recommendation = `Meilleur post pour ${args.objective} â utiliser en prioritÃ© avec create_ad_from_post`;
        else if (p.media_type === 'video') p.recommendation = `VidÃ©o performante â bon pour notoriÃ©tÃ© et engagement`;
        else p.recommendation = `Post solide â alternative crÃ©ative`;
      });

      return {
        objective: args.objective,
        posts_analyzed: posts.length,
        top_posts: top,
        usage_tip: `Utilise l'object_story_id du meilleur post avec create_ad_from_post ou create_full_campaign`
      };
    }

    // ââ CONTENUS INSTAGRAM âââââââââââââââââââââââââââââââââââââââââââââââââââ

    case 'get_instagram_account': {
      const data = await meta(`/${args.page_id}`, 'GET', null, {
        fields: 'instagram_business_account{id,username,name,followers_count,media_count,profile_picture_url}'
      });
      return data.instagram_business_account || { error: 'Aucun compte Instagram Business liÃ© Ã  cette page' };
    }

    case 'list_instagram_posts': {
      const params = {
        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        limit: args.limit || 20
      };
      const data = await meta(`/${args.ig_user_id}/media`, 'GET', null, params);
      let posts = data.data || [];
      if (args.media_type && args.media_type !== 'ALL') {
        posts = posts.filter(p => p.media_type === args.media_type);
      }
      return posts.map(p => ({
        id: p.id,
        caption: (p.caption || '').substring(0, 150),
        media_type: p.media_type,
        media_url: p.media_url || p.thumbnail_url,
        permalink: p.permalink,
        timestamp: p.timestamp,
        likes: p.like_count || 0,
        comments: p.comments_count || 0
      }));
    }

    case 'get_instagram_post_insights': {
      const metrics = p => {
        const base = ['impressions', 'reach', 'engagement', 'saved', 'profile_visits'];
        if (p === 'VIDEO' || p === 'REEL') return [...base, 'video_views', 'plays'].join(',');
        return base.join(',');
      };
      try {
        const post = await meta(`/${args.ig_media_id}`, 'GET', null, { fields: 'media_type' });
        const data = await meta(`/${args.ig_media_id}/insights`, 'GET', null, { metric: metrics(post.media_type) });
        const result = {};
        for (const item of (data.data || [])) {
          result[item.name] = item.values?.[0]?.value || item.value || 0;
        }
        return result;
      } catch (err) {
        return { error: `Insights indisponibles : ${err.message}` };
      }
    }

    case 'get_best_instagram_posts_for_ads': {
      const limit = args.limit || 20;
      const topN = args.top_n || 5;

      const data = await meta(`/${args.ig_user_id}/media`, 'GET', null, {
        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        limit
      });
      const posts = data.data || [];

      const withInsights = await Promise.all(posts.map(async (post) => {
        try {
          const metricsList = ['impressions', 'reach', 'engagement', 'saved'];
          if (post.media_type === 'VIDEO' || post.media_type === 'REELS') metricsList.push('video_views');
          const ins = await meta(`/${post.id}/insights`, 'GET', null, { metric: metricsList.join(',') });
          const values = {};
          for (const item of (ins.data || [])) {
            values[item.name] = item.values?.[0]?.value || item.value || 0;
          }
          return { ...post, _metrics: values };
        } catch {
          return { ...post, _metrics: {} };
        }
      }));

      const scored = withInsights.map(post => {
        const reach = post._metrics.reach || 0;
        const engagement = post._metrics.engagement || 0;
        const saves = post._metrics.saved || 0;
        const videoViews = post._metrics.video_views || 0;
        const engRate = reach > 0 ? engagement / reach : 0;

        let score = 0;
        switch (args.objective) {
          case 'reservation': score = engRate * 40 + saves * 2 + engagement * 0.5; break;
          case 'awareness': score = reach * 0.01 + videoViews * 0.005; break;
          case 'traffic': score = engagement * 1 + engRate * 30; break;
          default: score = engRate * 50 + saves * 1;
        }

        return {
          id: post.id,
          caption: (post.caption || '').substring(0, 150),
          media_type: post.media_type,
          media_url: post.media_url || post.thumbnail_url,
          permalink: post.permalink,
          timestamp: post.timestamp,
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
          reach,
          engagement,
          saves,
          video_views: videoViews,
          engagement_rate: reach > 0 ? (engRate * 100).toFixed(2) + '%' : 'N/A',
          score
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return {
        objective: args.objective,
        posts_analyzed: posts.length,
        top_posts: scored.slice(0, topN)
      };
    }

    // ââ ADS ÃCRITURE âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    case 'create_campaign': {
      const body = {
        name: args.name,
        objective: args.objective,
        status: args.status || 'PAUSED',
        special_ad_categories: (args.special_ad_categories && args.special_ad_categories.length > 0)
          ? args.special_ad_categories
          : []
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
        destination_type: args.destination_type || 'FACEBOOK',
        special_ad_categories: [],
        bid_strategy: args.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
        status: args.status || 'PAUSED'
      };
      if (args.start_time) body.start_time = args.start_time;
      if (args.end_time) body.end_time = args.end_time;
      const r = await meta(`/act_${args.account_id}/adsets`, 'POST', body);
      return { success: true, adset_id: r.id, name: args.name, status: args.status || 'PAUSED' };
    }

    case 'create_ad_creative': {
      let creativeBody = { name: args.name };
      if (args.object_story_id) {
        creativeBody.object_story_id = args.object_story_id;
      } else {
        if (!args.page_id || !args.message || !args.link) throw new Error('page_id, message et link requis en mode crÃ©ation');
        const link_data = { message: args.message, link: args.link, name: args.headline || '', description: args.description || '' };
        if (args.image_hash) link_data.image_hash = args.image_hash;
        if (args.call_to_action_type) link_data.call_to_action = { type: args.call_to_action_type, value: { link: args.link } };
        const story_spec = { page_id: args.page_id };
        if (args.video_id) {
          story_spec.video_data = { video_id: args.video_id, message: args.message, title: args.headline || '' };
        } else {
          story_spec.link_data = link_data;
        }
        creativeBody.object_story_spec = story_spec;
      }
      const r = await meta(`/act_${args.account_id}/adcreatives`, 'POST', creativeBody);
      return { success: true, creative_id: r.id, name: args.name };
    }

    case 'create_ad': {
      const r = await meta(`/act_${args.account_id}/ads`, 'POST', {
        name: args.name, adset_id: args.adset_id,
        creative: { creative_id: args.creative_id }, status: args.status || 'PAUSED'
      });
      return { success: true, ad_id: r.id, name: args.name, status: args.status || 'PAUSED' };
    }

    case 'create_ad_from_post': {
      const creativeName = args.creative_name || `CrÃ©atif Â· ${args.ad_name} Â· ${new Date().toLocaleDateString('fr-FR')}`;
      const creative = await meta(`/act_${args.account_id}/adcreatives`, 'POST', {
        name: creativeName, object_story_id: args.object_story_id
      });
      const ad = await meta(`/act_${args.account_id}/ads`, 'POST', {
        name: args.ad_name, adset_id: args.adset_id,
        creative: { creative_id: creative.id }, status: args.status || 'PAUSED'
      });
      return { success: true, creative_id: creative.id, ad_id: ad.id, ad_name: args.ad_name, status: args.status || 'PAUSED' };
    }

    case 'create_full_campaign': {
      // Ãtape 1 : campagne
      const campaignBody = {
        name: args.campaign_name,
        objective: args.campaign_objective,
        status: args.status || 'PAUSED',
        special_ad_categories: []
      };
      const campaign = await meta(`/act_${args.account_id}/campaigns`, 'POST', campaignBody);

      // Ãtape 2 : ad set
      const adset = await meta(`/act_${args.account_id}/adsets`, 'POST', {
        name: args.adset_name, campaign_id: campaign.id,
        daily_budget: Math.round(args.daily_budget_cents),
        targeting: args.targeting,
        optimization_goal: args.optimization_goal,
        billing_event: 'IMPRESSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status: args.status || 'PAUSED'
      });

      // Ãtape 3 : crÃ©atif depuis post existant
      const creative = await meta(`/act_${args.account_id}/adcreatives`, 'POST', {
        name: `CrÃ©atif Â· ${args.ad_name}`,
        object_story_id: args.object_story_id
      });

      // Ãtape 4 : pub
      const ad = await meta(`/act_${args.account_id}/ads`, 'POST', {
        name: args.ad_name, adset_id: adset.id,
        creative: { creative_id: creative.id }, status: args.status || 'PAUSED'
      });

      return {
        success: true,
        campaign_id: campaign.id,
        adset_id: adset.id,
        creative_id: creative.id,
        ad_id: ad.id,
        status: args.status || 'PAUSED',
        summary: `Campagne "${args.campaign_name}" crÃ©Ã©e complÃ¨te en 1 appel. Statut: PAUSED. Active depuis Meta Ads Manager quand prÃªt.`
      };
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
      return { success: true, new_campaign_id: r.copied_campaign_id };
    }

    case 'duplicate_adset': {
      const body = { status: args.status || 'PAUSED', deep_copy: true };
      if (args.target_campaign_id) body.campaign_id = args.target_campaign_id;
      const r = await meta(`/${args.adset_id}/copies`, 'POST', body);
      return { success: true, new_adset_id: r.copied_adset_id };
    }

    case 'duplicate_ad': {
      const body = { status: args.status || 'PAUSED' };
      if (args.target_adset_id) body.adset_id = args.target_adset_id;
      const r = await meta(`/${args.ad_id}/copies`, 'POST', body);
      return { success: true, new_ad_id: r.copied_ad_id };
    }

    case 'update_adset_targeting': {
      const r = await meta(`/${args.adset_id}`, 'POST', { targeting: args.targeting });
      return { success: r.success, adset_id: args.adset_id };
    }

    case 'create_website_audience': {
      const pixels = await meta(`/act_${args.account_id}/adspixels`, 'GET', null, { fields: 'id', limit: 1 });
      const pixel_id = args.pixel_id || pixels.data?.[0]?.id;
      if (!pixel_id) throw new Error('Aucun pixel trouvÃ©');
      const rule = args.event_name
        ? JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixel_id, type: 'pixel' }], retention_seconds: args.retention_days * 86400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: args.event_name }] } }] } })
        : JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixel_id, type: 'pixel' }], retention_seconds: args.retention_days * 86400 }] } });
      const r = await meta(`/act_${args.account_id}/customaudiences`, 'POST', { name: args.name, subtype: 'WEBSITE', rule, prefill: true });
      return { success: true, audience_id: r.id };
    }

    case 'create_lookalike_audience': {
      const r = await meta(`/act_${args.account_id}/customaudiences`, 'POST', {
        name: args.name, subtype: 'LOOKALIKE',
        origin_audience_id: args.origin_audience_id,
        lookalike_spec: JSON.stringify({ type: 'similarity', ratio: args.ratio || 0.01, country: args.country })
      });
      return { success: true, audience_id: r.id };
    }

    case 'upload_ad_image': {
      const r = await meta(`/act_${args.account_id}/adimages`, 'POST', { url: args.image_url, name: args.name || 'image' });
      const first = Object.values(r.images || {})[0];
      return { success: true, hash: first?.hash, url: first?.url };
    }

    case 'upload_ad_video': {
      const r = await meta(`/act_${args.account_id}/advideos`, 'POST', { file_url: args.video_url, title: args.title || 'video' });
      return { success: true, video_id: r.id };
    }

    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// MCP SERVER
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function createMCPServer() {
  const server = new Server(
    { name: 'dose-meta-mcp', version: '8.0.0' },
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
  res.json({ status: 'ok', server: 'dose-meta-mcp', version: '8.0.0', tools: TOOLS.length, meta_token: !!META_TOKEN });
});

app.all('/mcp', async (req, res) => {
  try {
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => server.close());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dose Meta MCP v8.0 â ${TOOLS.length} outils â port ${PORT}`);
  console.log(`Token: ${META_TOKEN ? 'OK' : 'MANQUANT'}`);
});
