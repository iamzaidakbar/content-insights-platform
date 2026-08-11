/* eslint-disable no-console */
// ---------------------------------------------------------------------------------------
// Content Insights Platform — demo seed script.
//
// Run with:
//   pnpm --filter @content-insights/api seed
//   # or: pnpm --filter @content-insights/api exec tsx src/scripts/seed.ts
//
// Hybrid approach:
//   - Organization/Users/Groups/Projects/Concepts/UserTags/SavedSearches/Insights/
//     Dashboards/GlobalSettings/EntityMapping are created via REAL HTTP calls against the
//     live API (http://localhost:4000/api/...), exercising real validation/permission
//     checks.
//   - Bulk Article content (10,000 unique articles) is inserted directly via Mongoose
//     (same MongoDB the API uses) and then indexed into Elasticsearch via the API's own
//     bulkIndexArticles helper.
//
// By default this wipes any previously-seeded "Meridian Media Intelligence" org (Mongo
// docs + its Elasticsearch index) before seeding, so re-runs never leave duplicate
// articles. Set SEED_RESET=0 to skip the wipe (register will fail if the org already
// exists).
// ---------------------------------------------------------------------------------------

import { randomUUID, createHash } from 'node:crypto';

import {
  EMPTY_FILTER_PANEL_STATE,
  type AdvancedSearch,
  type FilterPanelState,
} from '@content-insights/shared';

import { connectDB } from '../db/connect.js';
import { esClient, getOrgIndexName, bulkIndexArticles, type IndexArticleParams } from '../lib/elasticsearch.js';
import { slugify } from '../lib/slug.js';
import { ArticleModel } from '../models/article.model.js';
import { ChannelViewModel } from '../models/channelView.model.js';
import { ConceptModel } from '../models/concept.model.js';
import { DashboardModel } from '../models/dashboard.model.js';
import { EntityMappingModel } from '../models/entityMapping.model.js';
import { GlobalSettingsModel } from '../models/globalSettings.model.js';
import { GroupModel } from '../models/group.model.js';
import { GroupDefaultQueryModel } from '../models/groupDefaultQuery.model.js';
import { InsightModel } from '../models/insight.model.js';
import { OrganizationModel } from '../models/organization.model.js';
import { ProjectModel } from '../models/project.model.js';
import { RoleModel } from '../models/role.model.js';
import { SavedSearchModel } from '../models/savedSearch.model.js';
import { UserModel } from '../models/user.model.js';
import { UserSettingsModel } from '../models/userSettings.model.js';
import { UserTagModel } from '../models/userTag.model.js';

// ---------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------

const API_BASE = 'http://localhost:4000/api';
const ORG_NAME = 'Meridian Media Intelligence';
const ORG_SLUG = slugify(ORG_NAME);
const PASSWORD = 'ContentInsights!23';
const ADMIN_EMAIL = 'admin@meridian.dev';

/** Total unique articles across all projects (split evenly). */
const TOTAL_ARTICLES = 10_000;
/** insertMany / progress chunk size */
const ARTICLE_INSERT_CHUNK = 500;

const bugs: string[] = [];
function logBug(message: string): void {
  bugs.push(message);
  console.warn(`  [BUG] ${message}`);
}

// ---------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------

function rand(): number {
  return Math.random();
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  const item = arr[randInt(0, arr.length - 1)];
  if (item === undefined) throw new Error('pick() called on empty array');
  return item;
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = randInt(0, copy.length - 1);
    out.push(copy[idx] as T);
    copy.splice(idx, 1);
  }
  return out;
}
function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------------------
// HTTP client against the live API
// ---------------------------------------------------------------------------------------

interface ApiOk<T> {
  success: true;
  data: T;
}
interface ApiErr {
  success: false;
  message: string;
  code: string;
  fields?: Array<{ field: string; message: string }>;
}

class ApiCallError extends Error {
  constructor(
    public method: string,
    public path: string,
    public status: number,
    public body: ApiErr | null,
  ) {
    super(
      `${method} ${path} -> ${status} ${body?.code ?? ''} ${body?.message ?? ''} ${
        body?.fields ? JSON.stringify(body.fields) : ''
      }`,
    );
  }
}

async function api<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as ApiOk<T> | ApiErr) : null;
  if (!res.ok || !json || json.success === false) {
    throw new ApiCallError(method, path, res.status, (json as ApiErr) ?? null);
  }
  return (json as ApiOk<T>).data;
}

interface AuthSessionLike {
  accessToken: string;
  user: { id: string; email: string };
  org: { id: string };
  permissions: string[];
}

async function register(email: string, password: string, orgName: string): Promise<AuthSessionLike> {
  return api<AuthSessionLike>('POST', '/auth/register', { body: { email, password, orgName } });
}

const tokenCache = new Map<string, string>();
async function tokenFor(email: string, password: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;
  const session = await api<AuthSessionLike>('POST', '/auth/login', { body: { email, password } });
  tokenCache.set(email, session.accessToken);
  return session.accessToken;
}

// ---------------------------------------------------------------------------------------
// Domain lists (fixed upfront, used both for article generation and group hard-filter
// grants — see the brief's note that this is the cleaner approach).
// ---------------------------------------------------------------------------------------

const AVIATION_DOMAINS = [
  'skyline-aviation-news.example',
  'globalflight-tracker.example',
  'reuters-wire.example',
  'aerobulletin.example',
  'jetstream-daily.example',
  'airtraffic-monitor.example',
  'travelindustry-report.example',
  'wingspan-weekly.example',
];
const FINANCE_DOMAINS = [
  'reuters-wire.example',
  'globalfinance-daily.example',
  'marketpulse-news.example',
  'streetledger-bulletin.example',
  'capitalflow-report.example',
  'hedgeline-report.example',
  'quarterlyearnings-wire.example',
  'bluechip-monitor.example',
];
const REPUTATION_DOMAINS = [
  'reuters-wire.example',
  'globalfinance-daily.example',
  'corpwatch-daily.example',
  'brandintegrity-report.example',
  'reputationradar.example',
  'boardroom-bulletin.example',
  'consumervoice-news.example',
  'esginsight-daily.example',
];
const POLICY_DOMAINS = [
  'reuters-wire.example',
  'policywatch-bulletin.example',
  'govaffairs-daily.example',
  'regulatoryhorizon.example',
  'statehouse-wire.example',
  'publicrecord-monitor.example',
  'legislativetracker.example',
  'oversightreport.example',
];

// ---------------------------------------------------------------------------------------
// Project content definitions
// ---------------------------------------------------------------------------------------

interface EntityPick {
  org: string;
  org2: string;
  location: string;
  location2: string;
  country: string;
  phrase: string;
  phrase2: string;
  phrase3: string;
  airline: string;
  airline2: string;
  airport: string;
  airport2: string;
  spokesperson: string;
  domain: string;
}

interface ProjectDef {
  key: string;
  name: string;
  description: string;
  domains: string[];
  hasAviation: boolean;
  authorsPool: string[];
  oneOffAuthors: string[];
  keyPhrases: string[];
  organizations: string[];
  locations: string[];
  countries: string[];
  airports: string[];
  airlines: string[];
  spokespeople: string[];
  headline: (e: EntityPick) => string;
  lead: (e: EntityPick) => string;
  bodySentences: Array<(e: EntityPick) => string>;
  quote: (e: EntityPick) => string;
  closing: (e: EntityPick) => string;
}

const AVIATION_AIRPORTS = [
  'Heathrow (LHR)',
  'Dubai Intl (DXB)',
  'Changi (SIN)',
  'Frankfurt (FRA)',
  "O'Hare (ORD)",
  'Narita (NRT)',
  'Kingsford Smith (SYD)',
  'Schiphol (AMS)',
];
const AVIATION_AIRLINES = [
  'SkyBridge Airlines',
  'Meridian Air',
  'TransContinental Airways',
  'Horizon Wings',
  'Pacific Rim Air',
  'AeroNova',
  'Continental Express Air',
  'Northern Lights Airlines',
];

const PROJECT_DEFS: ProjectDef[] = [
  {
    key: 'aviation',
    name: 'Aviation & Travel Intelligence',
    description:
      'Tracking commercial aviation, airport operations, airline strategy, and global travel industry developments.',
    domains: AVIATION_DOMAINS,
    hasAviation: true,
    authorsPool: ['Maria Chen', 'David Okafor', 'Priya Raman', 'Tom Whitfield'],
    oneOffAuthors: ['Nina Sorensen', 'Kwame Boateng', 'Laila Haddad', 'Colin Bright', 'Yuki Tanaka', 'Fatima Zahra'],
    keyPhrases: [
      'flight delays',
      'air traffic control',
      'fuel efficiency',
      'route expansion',
      'codeshare agreement',
      'cabin crew shortage',
      'runway congestion',
      'sustainable aviation fuel',
      'loyalty program',
      'baggage handling',
      'turbulence incident',
      'pilot training',
      'airport security',
      'slot allocation',
      'low-cost carrier',
      'long-haul network',
      'fleet modernization',
      'carbon offset',
      'passenger experience',
      'ground handling',
    ],
    organizations: [
      'SkyBridge Airlines',
      'Meridian Aviation Authority',
      'Global Airports Alliance',
      'AeroTech Systems',
      'TransContinental Holdings',
      'International Air Transport Council',
      'Horizon Aerospace',
      'Continental Flight Academy',
      'AeroSafety Board',
      'Pacific Rim Aviation Group',
    ],
    locations: [
      'Heathrow Terminal 5',
      'Dubai International Hub',
      'Singapore Changi District',
      'Frankfurt Cargo Zone',
      "Chicago O'Hare Corridor",
      'Tokyo Narita Approach',
      'Sydney Kingsford Precinct',
      'Toronto Pearson Hub',
      'Amsterdam Schiphol Zone',
      'Doha Hamad Terminal',
      'Los Angeles Basin',
      'Johannesburg OR Tambo Hub',
    ],
    countries: [
      'United States',
      'United Kingdom',
      'Germany',
      'France',
      'United Arab Emirates',
      'Singapore',
      'Japan',
      'Australia',
      'Canada',
      'Netherlands',
      'Qatar',
      'China',
      'Brazil',
      'South Africa',
      'India',
    ],
    airports: AVIATION_AIRPORTS,
    airlines: AVIATION_AIRLINES,
    spokespeople: [
      'Chief Operating Officer Daniela Kroft',
      'network planning director Malik Fenwick',
      'safety board chair Renata Voss',
      'airport authority spokesperson Owen Castillo',
    ],
    headline: (e) => pick([
      `${e.airline} Expands ${e.country} Routes Amid ${e.phrase} Concerns`,
      `${e.org} Warns on ${e.phrase} as ${e.location} Traffic Surges`,
      `${e.airport} Reports Progress on ${e.phrase}`,
      `${e.airline} and ${e.org2} Sign Codeshare Deal Covering ${e.location}`,
      `Regulators Scrutinize ${e.phrase} After Incident Near ${e.airport}`,
      `${e.org} Data Shows ${e.phrase} Easing Across ${e.country} Network`,
    ]),
    lead: (e) =>
      `${e.airline} said Tuesday that its operations at ${e.airport} are being adjusted in response to ongoing ${e.phrase}, a shift that industry group ${e.org} has been monitoring closely across ${e.country}.`,
    bodySentences: [
      (e) => `Traffic through ${e.location} has climbed steadily this quarter, intensifying pressure on ${e.phrase2} across the network.`,
      (e) => `${e.org2} said its members are coordinating with regulators on ${e.phrase} to avoid disruptions during peak travel periods.`,
      (e) => `Analysts covering ${e.country} note that ${e.airline2}'s approach to ${e.phrase2} could set a precedent for smaller carriers.`,
      (e) => `The changes follow months of scrutiny over ${e.phrase} at ${e.airport2}, where officials have pushed for faster reforms.`,
      (e) => `Passenger groups operating out of ${e.location2} say the industry's response to ${e.phrase} has been uneven so far.`,
      (e) => `${e.org} expects the situation around ${e.phrase2} to stabilize before the next peak season begins.`,
    ],
    quote: (e) => `"We are treating ${e.phrase} as a top operational priority," said ${e.spokesperson} of ${e.org}. "Our teams at ${e.airport} are working directly with ${e.org2} to keep ${e.country} routes reliable."`,
    closing: (e) => `Industry watchers say the coming weeks will show whether ${e.airline}'s response to ${e.phrase} holds up as traffic through ${e.location} continues to grow.`,
  },
  {
    key: 'financial',
    name: 'Financial Markets Watch',
    description:
      'Monitoring financial markets, monetary policy, corporate earnings, and capital flows across major economies.',
    domains: FINANCE_DOMAINS,
    hasAviation: false,
    authorsPool: ['Elena Marsh', 'Rajiv Kapoor', 'Simon Blackwood', 'Anika Voss'],
    oneOffAuthors: ['Peter Lindqvist', 'Grace Osei', 'Marco Bellandi', 'Hana Suzuki', 'Derek Munro', 'Sofia Reyes'],
    keyPhrases: [
      'interest rate decision',
      'quarterly earnings',
      'market volatility',
      'inflation outlook',
      'bond yields',
      'equity rally',
      'central bank policy',
      'merger and acquisition',
      'IPO pricing',
      'credit rating downgrade',
      'commodity prices',
      'currency fluctuation',
      'hedge fund positioning',
      'dividend yield',
      'stock buyback',
      'recession risk',
      'supply chain costs',
      'labor market data',
      'yield curve inversion',
      'regulatory capital requirements',
    ],
    organizations: [
      'Meridian Capital Partners',
      'Northbridge Asset Management',
      'Continental Reserve Bank',
      'Global Markets Exchange',
      'Sterling Investment Group',
      'Apex Hedge Advisors',
      'Bluewater Securities',
      'Vantage Credit Union',
      'Pinnacle Pension Fund',
      'Ironclad Ratings Agency',
    ],
    locations: [
      'Wall Street District',
      'City of London Financial Quarter',
      'Frankfurt Banking Hub',
      'Hong Kong Central',
      'Singapore Marina Bay',
      'Zurich Private Banking District',
      'Tokyo Nihonbashi',
      'Toronto Bay Street',
      'Shanghai Lujiazui',
      'Dubai International Financial Centre',
      'Sydney CBD',
      'Mumbai Bandra-Kurla Complex',
    ],
    countries: [
      'United States',
      'United Kingdom',
      'Germany',
      'Switzerland',
      'Japan',
      'China',
      'Hong Kong',
      'Singapore',
      'Canada',
      'Australia',
      'India',
      'United Arab Emirates',
      'France',
      'South Korea',
      'Brazil',
    ],
    airports: [],
    airlines: [],
    spokespeople: [
      'Chief Investment Officer Nadia Ferro',
      'senior economist Bram Vestergaard',
      'markets strategist Wei Lin',
      'ratings committee chair Oliver Nkemelu',
    ],
    headline: (e) => pick([
      `${e.org} Flags ${e.phrase} Risk as ${e.country} Markets Wobble`,
      `${e.phrase} Drives Volatility Across ${e.location}`,
      `${e.org} and ${e.org2} Diverge on ${e.phrase} Outlook`,
      `Investors Watch ${e.phrase} Ahead of ${e.country} Data Release`,
      `${e.org} Report: ${e.phrase} Reshaping ${e.location} Trading`,
      `Analysts Debate ${e.phrase} Impact on ${e.country} Growth`,
    ]),
    lead: (e) =>
      `Trading desks in ${e.location} spent the session digesting fresh signals on ${e.phrase}, with ${e.org} warning that ${e.country} markets remain sensitive to any surprise.`,
    bodySentences: [
      (e) => `${e.org2} analysts said ${e.phrase2} is likely to stay elevated through the next reporting cycle.`,
      (e) => `Trading volumes out of ${e.location2} suggest investors are repositioning ahead of expected moves tied to ${e.phrase2}.`,
      (e) => `Officials in ${e.country} have signaled they are watching ${e.phrase} closely before any policy adjustment.`,
      (e) => `${e.org} said its own exposure to ${e.phrase2} remains within historical ranges despite the recent swings.`,
      (e) => `Portfolio managers covering ${e.location} flagged ${e.phrase} as the single biggest risk to near-term returns.`,
      (e) => `${e.org2} expects ${e.phrase2} to ease once ${e.country} releases its next round of economic data.`,
    ],
    quote: (e) => `"${e.phrase} is the dominant theme right now," said ${e.spokesperson} of ${e.org}. "We're advising clients in ${e.country} to stay disciplined until ${e.org2} clarifies its position."`,
    closing: (e) => `Whether ${e.phrase} continues to weigh on sentiment will likely depend on how ${e.org} and its peers in ${e.location} respond in the coming weeks.`,
  },
  {
    key: 'reputation',
    name: 'Corporate Reputation Monitoring',
    description:
      'Surfacing brand reputation signals, executive communications, crisis response, and consumer sentiment across industries.',
    domains: REPUTATION_DOMAINS,
    hasAviation: false,
    authorsPool: ['Grace Liu', 'Marcus Feldman', 'Isabelle Duarte', 'Owen Whitfield'],
    oneOffAuthors: ['Camille Duval', 'Ahmed Farouk', 'Bianca Rossi', 'Trevor Nakamura', 'Ingrid Solberg', 'Diego Alvarado'],
    keyPhrases: [
      'brand reputation',
      'crisis communications',
      'consumer sentiment',
      'executive statement',
      'product recall',
      'corporate governance',
      'sustainability report',
      'shareholder activism',
      'workplace culture',
      'data breach response',
      'greenwashing allegation',
      'boycott campaign',
      'media scrutiny',
      'trust rebuilding',
      'social media backlash',
      'leadership transition',
      'diversity commitment',
      'supply chain ethics',
      'customer loyalty',
      'public apology',
    ],
    organizations: [
      'Meridian Consumer Goods',
      'Northstar Retail Group',
      'Vantage Manufacturing',
      'Cascade Foods Corporation',
      'BrightPath Technologies',
      'Union Apparel Holdings',
      'Everline Pharmaceuticals',
      'Coastal Energy Partners',
      'Summit Automotive Group',
      'Clearwater Beverages',
    ],
    locations: [
      'Chicago headquarters district',
      'Atlanta distribution hub',
      'Dallas regional office',
      'Seattle innovation campus',
      'Boston flagship district',
      'Denver logistics hub',
      'Minneapolis manufacturing zone',
      'Charlotte customer service center',
      'Phoenix retail corridor',
      'Portland sustainability lab',
      'Nashville sales office',
      'Columbus distribution center',
    ],
    countries: [
      'United States',
      'United Kingdom',
      'Germany',
      'France',
      'Canada',
      'Mexico',
      'Japan',
      'Australia',
      'Brazil',
      'India',
      'Netherlands',
      'South Korea',
      'Italy',
      'Spain',
      'Sweden',
    ],
    airports: [],
    airlines: [],
    spokespeople: [
      'Chief Communications Officer Renee Castellan',
      'brand strategy lead Youssef Amrani',
      'consumer insights director Petra Novak',
      'crisis response advisor Alan Whitcombe',
    ],
    headline: (e) => pick([
      `${e.org} Faces ${e.phrase} After ${e.location} Incident`,
      `${e.phrase} Puts ${e.org} Under Media Scrutiny`,
      `${e.org} Responds to ${e.phrase} With New ${e.phrase2} Push`,
      `Consumers React to ${e.org}'s ${e.phrase}`,
      `${e.org} and ${e.org2} Both Navigating ${e.phrase} This Quarter`,
      `${e.org} Rolls Out ${e.phrase2} Plan to Address ${e.phrase}`,
    ]),
    lead: (e) =>
      `${e.org} is facing renewed attention over ${e.phrase} following developments at its ${e.location}, prompting comparisons with how ${e.org2} handled a similar episode.`,
    bodySentences: [
      (e) => `Consumer researchers tracking ${e.country} say ${e.phrase2} has become a defining factor in how the public views the company.`,
      (e) => `Employees at the ${e.location2} have described the response internally as a test of the company's stated commitment to ${e.phrase2}.`,
      (e) => `${e.org2} has faced similar questions over ${e.phrase} in the past year, according to coverage from ${e.country}.`,
      (e) => `Analysts say ${e.org}'s handling of ${e.phrase2} will shape investor confidence heading into the next reporting period.`,
      (e) => `Social listening data out of ${e.country} shows sentiment around ${e.phrase} remains mixed among younger consumers.`,
      (e) => `${e.org} maintains that its ${e.phrase2} commitments predate the current controversy.`,
    ],
    quote: (e) => `"${e.phrase} is something we take extremely seriously," said ${e.spokesperson} of ${e.org}. "We are working with stakeholders in ${e.country} to rebuild trust through concrete ${e.phrase2} steps."`,
    closing: (e) => `How ${e.org} manages ${e.phrase} in the coming weeks will likely determine whether the episode becomes a lasting reputational drag or a footnote.`,
  },
  {
    key: 'policy',
    name: 'Public Policy & Regulation',
    description:
      'Following regulatory developments, legislative activity, enforcement actions, and public policy debates across jurisdictions.',
    domains: POLICY_DOMAINS,
    hasAviation: false,
    authorsPool: ['Diane Coleman', 'Youssef Haddad', 'Rebecca Lin', 'Patrick Nolan'],
    oneOffAuthors: ['Helena Brandt', 'Samuel Osei', 'Chiara Bianchi', 'Farid Amiri', 'Louisa Everhart', 'Minh Tran'],
    keyPhrases: [
      'regulatory framework',
      'public consultation',
      'legislative amendment',
      'compliance deadline',
      'policy reform',
      'antitrust investigation',
      'data privacy law',
      'environmental regulation',
      'tax policy change',
      'trade agreement',
      'lobbying disclosure',
      'committee hearing',
      'executive order',
      'regulatory sandbox',
      'enforcement action',
      'whistleblower protection',
      'public comment period',
      'statutory review',
      'cross-border regulation',
      'sunset clause',
    ],
    organizations: [
      'National Regulatory Commission',
      'Office of Public Oversight',
      'Consumer Protection Bureau',
      'Environmental Standards Council',
      'Legislative Policy Institute',
      'Cross-Border Trade Authority',
      'Public Integrity Office',
      'Data Privacy Council',
      'Antitrust Enforcement Division',
      'Judicial Oversight Panel',
    ],
    locations: [
      'Capitol Hill',
      'Whitehall',
      'Brussels Quarter',
      'Geneva International District',
      'Ottawa Parliament District',
      'Canberra Government Precinct',
      'The Hague',
      'Strasbourg Chamber District',
      'Vienna International Centre',
      'New York UN District',
      'Delhi Government Complex',
      'Pretoria Union Buildings',
    ],
    countries: [
      'United States',
      'United Kingdom',
      'Germany',
      'France',
      'Belgium',
      'Switzerland',
      'Canada',
      'Australia',
      'Netherlands',
      'Austria',
      'India',
      'South Africa',
      'Japan',
      'Ireland',
      'Singapore',
    ],
    airports: [],
    airlines: [],
    spokespeople: [
      'committee chair Senator-designate Lorna Achebe',
      'regulatory affairs director Peter Vandenberg',
      'policy counsel Aisha Rahman',
      'oversight board spokesperson Julian Kowalski',
    ],
    headline: (e) => pick([
      `${e.org} Proposes New ${e.phrase} Covering ${e.country}`,
      `Lawmakers Debate ${e.phrase} at ${e.location}`,
      `${e.org} Launches ${e.phrase} Into Cross-Border Practices`,
      `${e.country} Moves Forward on ${e.phrase}`,
      `${e.org} and ${e.org2} Clash Over ${e.phrase}`,
      `${e.phrase} Advances After ${e.location} Hearing`,
    ]),
    lead: (e) =>
      `Regulators at ${e.location} advanced a new round of ${e.phrase} on Tuesday, a move ${e.org} says will bring ${e.country}'s rules closer in line with international norms.`,
    bodySentences: [
      (e) => `${e.org2} has pushed for a slower timeline on ${e.phrase2}, arguing that businesses in ${e.country} need more time to adapt.`,
      (e) => `The proposal follows months of ${e.phrase} activity centered on ${e.location2}.`,
      (e) => `Officials say the ${e.phrase2} is designed to close gaps identified during a prior review of ${e.country}'s framework.`,
      (e) => `Civil society groups monitoring ${e.location} have called for a longer public comment window before the rules take effect.`,
      (e) => `${e.org} expects the ${e.phrase2} to be finalized before the next legislative session in ${e.country}.`,
      (e) => `Industry groups warn that overlapping ${e.phrase2} requirements could create compliance headaches across jurisdictions.`,
    ],
    quote: (e) => `"This ${e.phrase} reflects years of consultation," said ${e.spokesperson} of ${e.org}. "We believe it strikes the right balance for ${e.country} without discouraging investment."`,
    closing: (e) => `The coming weeks at ${e.location} will determine whether ${e.org} secures enough support to move the ${e.phrase} forward.`,
  },
];

// ---------------------------------------------------------------------------------------
// Concept definitions per project
// ---------------------------------------------------------------------------------------

interface ConceptDef {
  name: string;
  key: string;
  placement: 'hard' | 'soft';
  displayLabel: string;
}

// NOTE on the hard concept's key: each project gets its OWN "Website Domain/Source" concept
// (same display name everywhere — Concept name-uniqueness is scoped per-project, so that's
// fine), but the underlying `key` is deliberately suffixed per project (source_domain_aviation,
// source_domain_financial, ...) rather than reused verbatim across projects.
//
// This sidesteps a confirmed live bug in the current codebase: ArticleSearchGrants.hardFilterGrants
// (apps/api/src/lib/article-access.ts's resolveArticleSearchGrants) is built as one flat entry
// per hard-placement Concept document across EVERY project a group is granted — with no
// project scoping carried into HardFilterGrantWithKey. buildArticleFilterClauses (lib/search.ts)
// then pushes one `{terms: {taxonomyValues.<key>: allowedValues}}` clause per entry into a single
// AND'd bool.filter array. If two+ granted projects define a hard concept under the SAME key
// (exactly the natural setup for a shared "Website Domain/Source" taxonomy label), a document
// must satisfy every one of those projects' grants simultaneously to appear at all — even though
// only the grant for the document's OWN project should apply. See the final report for full
// repro details; this was left as a flagged, not-fixed platform bug (out of scope to safely fix
// here — it also affects lib/savedSearch.service.ts's resolveGroupAccessContext, which silently
// LAST-WRITE-WINS across projects on key collision instead of AND-ing, a different symptom of
// the same root cause). Soft concepts are unaffected (never restricted at the query level).
function commonConcepts(projectKey: string): ConceptDef[] {
  return [
    {
      name: 'Website Domain/Source',
      key: `source_domain_${projectKey}`,
      placement: 'hard',
      displayLabel: 'Website Domain / Source',
    },
    { name: 'Authors', key: 'authors', placement: 'soft', displayLabel: 'Authors' },
    { name: 'Key Phrases', key: 'key_phrases', placement: 'soft', displayLabel: 'Key Phrases' },
    { name: 'Organizations', key: 'organizations', placement: 'soft', displayLabel: 'Organizations' },
    { name: 'Locations', key: 'locations', placement: 'soft', displayLabel: 'Locations' },
    { name: 'Countries', key: 'countries', placement: 'soft', displayLabel: 'Countries' },
  ];
}
const AVIATION_EXTRA_CONCEPTS: ConceptDef[] = [
  { name: 'Airports', key: 'airports', placement: 'soft', displayLabel: 'Airports' },
  { name: 'Airlines', key: 'airlines', placement: 'soft', displayLabel: 'Airlines' },
];

function conceptsForProject(def: ProjectDef): ConceptDef[] {
  const common = commonConcepts(def.key);
  return def.hasAviation ? [...common, ...AVIATION_EXTRA_CONCEPTS] : common;
}

function hardDomainConceptKey(projectKey: string): string {
  return `source_domain_${projectKey}`;
}

// ---------------------------------------------------------------------------------------
// Group definitions (name/description/granted projects/domain grants)
// ---------------------------------------------------------------------------------------

interface DomainGrantDef {
  allowed: string[];
  denialNote?: string;
}
interface GroupDef {
  key: string;
  name: string;
  description: string;
  projectKeys: string[];
  domainGrants: Record<string, DomainGrantDef>; // projectKey -> grant
}

const GROUP_DEFS: GroupDef[] = [
  {
    key: 'comms',
    name: 'Corporate Communications',
    description: 'Owns external messaging, brand monitoring, and policy narrative for the organization.',
    projectKeys: ['reputation', 'policy'],
    domainGrants: {
      reputation: {
        allowed: [
          'reuters-wire.example',
          'globalfinance-daily.example',
          'brandintegrity-report.example',
          'reputationradar.example',
          'boardroom-bulletin.example',
          'consumervoice-news.example',
        ],
      },
      policy: {
        allowed: [
          'reuters-wire.example',
          'policywatch-bulletin.example',
          'govaffairs-daily.example',
          'regulatoryhorizon.example',
          'statehouse-wire.example',
          'publicrecord-monitor.example',
        ],
      },
    },
  },
  {
    key: 'risk',
    name: 'Risk & Compliance',
    description: 'Reviews financial, reputational, and regulatory risk signals across the portfolio.',
    projectKeys: ['financial', 'reputation', 'policy'],
    domainGrants: {
      financial: {
        allowed: ['reuters-wire.example', 'globalfinance-daily.example'],
        denialNote:
          'Only wire-service sources are cleared for Compliance review; blog and social-aggregator sources are withheld pending legal review.',
      },
      reputation: {
        allowed: [
          'reuters-wire.example',
          'globalfinance-daily.example',
          'corpwatch-daily.example',
          'boardroom-bulletin.example',
          'esginsight-daily.example',
        ],
      },
      policy: {
        allowed: [
          'reuters-wire.example',
          'govaffairs-daily.example',
          'regulatoryhorizon.example',
          'legislativetracker.example',
          'oversightreport.example',
        ],
      },
    },
  },
  {
    key: 'exec',
    name: 'Executive Briefing',
    description: 'Curated cross-topic coverage prepared for senior leadership review.',
    projectKeys: ['aviation', 'financial', 'reputation'],
    domainGrants: {
      aviation: {
        allowed: [
          'skyline-aviation-news.example',
          'globalflight-tracker.example',
          'reuters-wire.example',
          'aerobulletin.example',
          'jetstream-daily.example',
          'wingspan-weekly.example',
        ],
      },
      financial: {
        allowed: [
          'reuters-wire.example',
          'globalfinance-daily.example',
          'marketpulse-news.example',
          'capitalflow-report.example',
          'hedgeline-report.example',
          'bluechip-monitor.example',
        ],
      },
      reputation: {
        allowed: [
          'reuters-wire.example',
          'globalfinance-daily.example',
          'corpwatch-daily.example',
          'brandintegrity-report.example',
          'reputationradar.example',
          'esginsight-daily.example',
        ],
      },
    },
  },
  {
    key: 'market',
    name: 'Market Research Desk',
    description: 'Deep-dive research coverage of aviation and financial market trends.',
    projectKeys: ['aviation', 'financial'],
    domainGrants: {
      aviation: { allowed: [...AVIATION_DOMAINS] },
      financial: {
        allowed: FINANCE_DOMAINS.filter((d) => d !== 'quarterlyearnings-wire.example'),
      },
    },
  },
];

// ---------------------------------------------------------------------------------------
// User definitions
// ---------------------------------------------------------------------------------------

interface RoleAssignmentDef {
  roleName: string;
  groupKey: string | null;
  startDate?: string | null;
  endDate?: string | null;
}
interface UserDef {
  email: string;
  displayName: string;
  assignments: RoleAssignmentDef[];
  currentGroupKey?: string | null;
}

const now = new Date();
const timeBoundEnd = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString(); // ~4 months out

const USER_DEFS: UserDef[] = [
  { email: 'sysadmin@meridian.dev', displayName: 'Sam Osei', assignments: [{ roleName: 'Application Admin', groupKey: null }] },
  {
    email: 'groupadmin.comms@meridian.dev',
    displayName: 'Renee Castellan',
    assignments: [{ roleName: 'User Group Admin', groupKey: 'comms' }],
    currentGroupKey: 'comms',
  },
  {
    email: 'groupadmin.risk@meridian.dev',
    displayName: 'Alan Whitcombe',
    assignments: [{ roleName: 'User Group Admin', groupKey: 'risk' }],
    currentGroupKey: 'risk',
  },
  {
    email: 'analyst.compliance@meridian.dev',
    displayName: 'Nadia Ferro',
    assignments: [{ roleName: 'Analyst', groupKey: 'risk' }],
    currentGroupKey: 'risk',
  },
  {
    email: 'analyst.exec@meridian.dev',
    displayName: 'Bram Vestergaard',
    assignments: [{ roleName: 'Analyst', groupKey: 'exec' }],
    currentGroupKey: 'exec',
  },
  {
    email: 'analyst.market@meridian.dev',
    displayName: 'Wei Lin',
    assignments: [{ roleName: 'Analyst', groupKey: 'market' }],
    currentGroupKey: 'market',
  },
  {
    email: 'analyst.comms@meridian.dev',
    displayName: 'Youssef Amrani',
    assignments: [{ roleName: 'Analyst', groupKey: 'comms' }],
    currentGroupKey: 'comms',
  },
  {
    email: 'analyst.multi@meridian.dev',
    displayName: 'Petra Novak',
    assignments: [
      { roleName: 'Analyst', groupKey: 'exec' },
      { roleName: 'Analyst', groupKey: 'market' },
    ],
    currentGroupKey: 'exec',
  },
  {
    email: 'analyst.timebound@meridian.dev',
    displayName: 'Oliver Nkemelu',
    assignments: [{ roleName: 'Analyst', groupKey: 'risk', startDate: now.toISOString(), endDate: timeBoundEnd }],
    currentGroupKey: 'risk',
  },
  {
    email: 'readonly@meridian.dev',
    displayName: 'Ingrid Solberg',
    assignments: [{ roleName: 'Read-Only', groupKey: 'comms' }],
    currentGroupKey: 'comms',
  },
  {
    email: 'publisher@meridian.dev',
    displayName: 'Malik Fenwick',
    assignments: [{ roleName: 'Publisher', groupKey: 'market' }],
    currentGroupKey: 'market',
  },
  {
    email: 'sharer@meridian.dev',
    displayName: 'Aisha Rahman',
    assignments: [
      { roleName: 'Analyst', groupKey: 'exec' },
      { roleName: 'Sharing Rights Into', groupKey: 'exec' },
    ],
    currentGroupKey: 'exec',
  },
];

// ---------------------------------------------------------------------------------------
// Reset — wipes a previously-seeded Meridian org so this script can be re-run cleanly
// without duplicate articles (orgId+locationHash is unique).
// ---------------------------------------------------------------------------------------

async function resetPriorSeedData(): Promise<void> {
  const org = await OrganizationModel.findOne({ slug: ORG_SLUG });
  if (!org) {
    console.log('  No prior Meridian org found — nothing to reset.');
    return;
  }
  const orgId = org._id;
  console.log(`  Wiping prior org ${orgId.toString()} ...`);

  const savedSearchIds = await SavedSearchModel.find({ orgId }, { _id: 1 }).then((docs) => docs.map((d) => d._id));

  await Promise.all([
    UserModel.deleteMany({ orgId }),
    UserSettingsModel.deleteMany({ orgId }),
    RoleModel.deleteMany({ orgId }),
    GroupModel.deleteMany({ orgId }),
    GroupDefaultQueryModel.deleteMany({ orgId }),
    ProjectModel.deleteMany({ orgId }),
    ConceptModel.deleteMany({ orgId }),
    ArticleModel.deleteMany({ orgId }),
    UserTagModel.deleteMany({ orgId }),
    SavedSearchModel.deleteMany({ orgId }),
    InsightModel.deleteMany({ orgId }),
    DashboardModel.deleteMany({ orgId }),
    GlobalSettingsModel.deleteMany({ orgId }),
    EntityMappingModel.deleteMany({ orgId }),
    ChannelViewModel.deleteMany({ savedSearchId: { $in: savedSearchIds } }),
  ]);
  await OrganizationModel.deleteOne({ _id: orgId });

  try {
    await esClient.indices.delete({ index: getOrgIndexName(orgId.toString()) });
  } catch {
    // index may not exist — fine
  }
  console.log('  Reset complete.');
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

interface ProjectRuntime {
  def: ProjectDef;
  id: string;
  concepts: Array<{ id: string; key: string; name: string; placement: 'hard' | 'soft' }>;
}

interface GroupRuntime {
  def: GroupDef;
  id: string;
}

interface SeededUser {
  email: string;
  displayName: string;
  password: string;
  temporary: boolean;
  id: string;
  roles: string[]; // "RoleName @ GroupName" strings, for the report
}

interface InsertedArticle {
  _id: string;
  projectKey: string;
  domain: string;
  sourceType: 'news' | 'file_system';
  hidden: boolean;
  publishedAt: Date;
  taxonomyValues: Record<string, string[]>;
}

async function main(): Promise<void> {
  console.log('Connecting to MongoDB...');
  await connectDB();

  // Default: wipe prior Meridian seed so articles are never duplicated on re-run.
  // Opt out with SEED_RESET=0 only when you intentionally want to keep existing data.
  if (process.env.SEED_RESET !== '0') {
    console.log('Wiping any prior Meridian seed data (set SEED_RESET=0 to skip)...');
    await resetPriorSeedData();
  }

  // ---------------------------------------------------------------------------------
  // 1. Organization + Application Admin
  // ---------------------------------------------------------------------------------
  console.log(`\n[1/12] Registering organization "${ORG_NAME}" with admin ${ADMIN_EMAIL} ...`);
  const adminSession = await register(ADMIN_EMAIL, PASSWORD, ORG_NAME);
  const adminToken = adminSession.accessToken;
  const orgId = adminSession.org.id;
  console.log(`  Org id: ${orgId}`);

  const seededUsers: SeededUser[] = [
    {
      email: ADMIN_EMAIL,
      displayName: 'Meridian Admin',
      password: PASSWORD,
      temporary: false,
      id: adminSession.user.id,
      roles: ['Application Admin @ All (global)'],
    },
  ];

  // ---------------------------------------------------------------------------------
  // 2. Roles
  // ---------------------------------------------------------------------------------
  console.log('\n[2/12] Fetching system roles ...');
  const roles = await api<Array<{ id: string; name: string }>>('GET', '/roles', { token: adminToken });
  const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));
  for (const name of ['Application Admin', 'User Group Admin', 'Analyst', 'Read-Only', 'Publisher', 'Sharing Rights Into']) {
    if (!roleIdByName.has(name)) throw new Error(`Expected system role "${name}" not found`);
  }
  console.log(`  ${roles.length} roles loaded.`);

  // ---------------------------------------------------------------------------------
  // 3. Projects
  // ---------------------------------------------------------------------------------
  console.log('\n[3/12] Creating projects ...');
  const projects: Record<string, ProjectRuntime> = {};
  for (const def of PROJECT_DEFS) {
    const project = await api<{ id: string }>('POST', '/projects', {
      token: adminToken,
      body: { name: def.name, description: def.description },
    });
    projects[def.key] = { def, id: project.id, concepts: [] };
    console.log(`  + ${def.name} (${project.id})`);
  }

  // ---------------------------------------------------------------------------------
  // 4. Concepts per project
  // ---------------------------------------------------------------------------------
  console.log('\n[4/12] Creating concepts ...');
  for (const proj of Object.values(projects)) {
    for (const c of conceptsForProject(proj.def)) {
      const concept = await api<{ id: string }>('POST', `/concepts?projectId=${proj.id}`, {
        token: adminToken,
        body: { name: c.name, key: c.key, placement: c.placement, displayLabel: c.displayLabel },
      });
      proj.concepts.push({ id: concept.id, key: c.key, name: c.name, placement: c.placement });
    }
    console.log(`  + ${proj.concepts.length} concepts for ${proj.def.name}`);
  }

  // ---------------------------------------------------------------------------------
  // 5. Groups + data access
  // ---------------------------------------------------------------------------------
  console.log('\n[5/12] Creating groups and configuring data access ...');
  const groups: Record<string, GroupRuntime> = {};
  for (const gdef of GROUP_DEFS) {
    const group = await api<{ id: string }>('POST', '/groups', {
      token: adminToken,
      body: { name: gdef.name, description: gdef.description },
    });
    groups[gdef.key] = { def: gdef, id: group.id };

    const projectIds = gdef.projectKeys.map((k) => (projects[k] as ProjectRuntime).id);
    await api('PUT', `/groups/${group.id}/data-access/projects`, {
      token: adminToken,
      body: { projectIds },
    });

    const hardFilterGrants = gdef.projectKeys.map((pk) => {
      const proj = projects[pk] as ProjectRuntime;
      const concept = proj.concepts.find((c) => c.placement === 'hard');
      if (!concept) throw new Error(`No hard source-domain concept for project ${pk}`);
      const grant = gdef.domainGrants[pk];
      if (!grant) throw new Error(`No domain grant defined for group ${gdef.key} / project ${pk}`);
      return {
        conceptId: concept.id,
        conceptName: concept.name,
        allowedValues: grant.allowed,
        ...(grant.denialNote ? { denialNote: grant.denialNote } : {}),
      };
    });
    await api('PUT', `/groups/${group.id}/data-access/hard-filters`, {
      token: adminToken,
      body: { hardFilterGrants },
    });

    let order = 0;
    const softFilterConcepts: Array<{ conceptId: string; conceptName: string; order: number }> = [];
    for (const pk of gdef.projectKeys) {
      const proj = projects[pk] as ProjectRuntime;
      for (const c of proj.concepts.filter((c) => c.placement === 'soft')) {
        softFilterConcepts.push({ conceptId: c.id, conceptName: c.name, order: order++ });
      }
    }
    await api('PUT', `/groups/${group.id}/data-access/soft-filters`, {
      token: adminToken,
      body: { softFilterConcepts },
    });

    console.log(
      `  + ${gdef.name} (${group.id}) — projects=[${gdef.projectKeys.join(', ')}], hard grants=${hardFilterGrants.length}, soft grants=${softFilterConcepts.length}`,
    );
  }

  // ---------------------------------------------------------------------------------
  // 6. Additional users + role assignments + currentGroupId
  // ---------------------------------------------------------------------------------
  console.log('\n[6/12] Creating additional users and assigning roles ...');
  const usersByEmail = new Map<string, SeededUser>();
  for (const udef of USER_DEFS) {
    const created = await api<{ user: { id: string }; temporaryPassword: string }>('POST', '/users', {
      token: adminToken,
      body: { email: udef.email, displayName: udef.displayName },
    });
    const seeded: SeededUser = {
      email: udef.email,
      displayName: udef.displayName,
      password: created.temporaryPassword,
      temporary: true,
      id: created.user.id,
      roles: [],
    };
    usersByEmail.set(udef.email, seeded);
    seededUsers.push(seeded);

    for (const assignment of udef.assignments) {
      const roleId = roleIdByName.get(assignment.roleName);
      if (!roleId) throw new Error(`Unknown role ${assignment.roleName}`);
      const groupId = assignment.groupKey ? (groups[assignment.groupKey] as GroupRuntime).id : null;
      await api('POST', `/users/${created.user.id}/role-assignments`, {
        token: adminToken,
        body: {
          roleId,
          groupId,
          startDate: assignment.startDate ?? null,
          endDate: assignment.endDate ?? null,
        },
      });
      const groupLabel = assignment.groupKey ? (groups[assignment.groupKey] as GroupRuntime).def.name : 'All (global)';
      seeded.roles.push(`${assignment.roleName} @ ${groupLabel}${assignment.endDate ? ' (time-bound)' : ''}`);
    }
    console.log(`  + ${udef.email} — ${seeded.roles.join('; ')}`);
  }

  console.log('\n  Setting currentGroupId for users that need group-scoped context ...');
  for (const udef of USER_DEFS) {
    if (!udef.currentGroupKey) continue;
    const seeded = usersByEmail.get(udef.email);
    if (!seeded) continue;
    const token = await tokenFor(udef.email, seeded.password);
    const groupId = (groups[udef.currentGroupKey] as GroupRuntime).id;
    await api('PATCH', '/users/me/current-group', { token, body: { groupId } });
  }
  console.log('  Done.');

  // ---------------------------------------------------------------------------------
  // 7. Articles — direct Mongoose bulk insert + Elasticsearch bulk index (10,000 unique)
  // ---------------------------------------------------------------------------------
  console.log('\n[7/12] Generating and inserting articles ...');
  const projectList = Object.values(projects);
  const ARTICLES_PER_PROJECT = Math.floor(TOTAL_ARTICLES / projectList.length);
  const remainder = TOTAL_ARTICLES - ARTICLES_PER_PROJECT * projectList.length;
  console.log(
    `  Target ${TOTAL_ARTICLES.toLocaleString()} articles across ${projectList.length} projects ` +
      `(${ARTICLES_PER_PROJECT.toLocaleString()} each` +
      (remainder > 0 ? `, +${remainder} on first project` : '') +
      ').',
  );

  const insertedArticles: InsertedArticle[] = [];
  const esDocs: IndexArticleParams[] = [];
  const seenHashes = new Set<string>();

  for (let projectIndex = 0; projectIndex < projectList.length; projectIndex++) {
    const proj = projectList[projectIndex] as ProjectRuntime;
    const def = proj.def;
    const count = ARTICLES_PER_PROJECT + (projectIndex === 0 ? remainder : 0);
    const specs: Array<{
      domain: string;
      sourceType: 'news' | 'file_system';
      hidden: boolean;
      publishedAt: Date;
      serial: string;
    }> = [];

    const idx = shuffle(Array.from({ length: count }, (_, i) => i));
    const fsSet = new Set(shuffle(idx).slice(0, Math.round(count * 0.15)));
    const hiddenSet = new Set(shuffle(idx).slice(0, Math.max(1, Math.round(count * 0.03))));
    const dateShuffled = shuffle(idx);
    const last7Set = new Set(dateShuffled.slice(0, Math.round(count * 0.15)));
    const midSet = new Set(
      dateShuffled.slice(Math.round(count * 0.15), Math.round(count * 0.15) + Math.round(count * 0.3)),
    );

    for (let i = 0; i < count; i++) {
      let offsetDays: number;
      if (last7Set.has(i)) offsetDays = randInt(0, 7);
      else if (midSet.has(i)) offsetDays = randInt(7, 30);
      else offsetDays = randInt(30, 365);
      const publishedAt = new Date(now.getTime() - offsetDays * 86_400_000 - randInt(0, 86_400_000));
      const serial = `${def.key.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
      specs.push({
        domain: pick(def.domains),
        sourceType: fsSet.has(i) ? 'file_system' : 'news',
        hidden: hiddenSet.has(i),
        publishedAt,
        serial,
      });
    }

    const docs: Array<Record<string, unknown>> = [];
    for (const spec of specs) {
      const orgCount = randInt(1, 2);
      const orgsPicked = pickN(def.organizations, orgCount + 1);
      const locsPicked = pickN(def.locations, 2);
      const phrasesPicked = pickN(def.keyPhrases, 3);
      const countryPicked = pick(def.countries);
      const authorCount = pick([1, 1, 1, 2, 2, 3]);
      const authorsPicked = pickN(
        rand() < 0.7 ? def.authorsPool : [...def.authorsPool, ...def.oneOffAuthors],
        Math.min(authorCount, def.authorsPool.length + def.oneOffAuthors.length),
      );

      const entity: EntityPick = {
        org: orgsPicked[0] as string,
        org2: (orgsPicked[1] ?? orgsPicked[0]) as string,
        location: locsPicked[0] as string,
        location2: (locsPicked[1] ?? locsPicked[0]) as string,
        country: countryPicked,
        phrase: phrasesPicked[0] as string,
        phrase2: (phrasesPicked[1] ?? phrasesPicked[0]) as string,
        phrase3: (phrasesPicked[2] ?? phrasesPicked[0]) as string,
        airline: def.airlines.length > 0 ? pick(def.airlines) : '',
        airline2: def.airlines.length > 0 ? pick(def.airlines) : '',
        airport: def.airports.length > 0 ? pick(def.airports) : '',
        airport2: def.airports.length > 0 ? pick(def.airports) : '',
        spokesperson: pick(def.spokespeople),
        domain: spec.domain,
      };

      // Unique title + locationHash — serial guarantees no orgId+locationHash collisions
      // even when headline templates recycle the same entity combo.
      const title = `${def.headline(entity)} (${spec.serial})`;
      const summary = def.lead(entity);

      let sentenceQueue = shuffle(def.bodySentences);
      let sentenceIdx = 0;
      const nextSentence = (): string => {
        if (sentenceIdx >= sentenceQueue.length) {
          sentenceQueue = shuffle(def.bodySentences);
          sentenceIdx = 0;
        }
        const fn = sentenceQueue[sentenceIdx++] as (e: EntityPick) => string;
        return fn(entity);
      };

      const paragraphCount = randInt(3, 6);
      const paragraphs: string[] = [summary + ' ' + nextSentence()];
      paragraphs.push(nextSentence() + ' ' + nextSentence());
      paragraphs.push(def.quote(entity));
      const fillerNeeded = paragraphCount - paragraphs.length;
      for (let p = 0; p < fillerNeeded - 1; p++) {
        paragraphs.push(nextSentence() + ' ' + nextSentence());
      }
      if (fillerNeeded >= 1) paragraphs.push(def.closing(entity));
      const body = paragraphs.join('\n\n');

      const taxonomyValues: Record<string, string[]> = {
        [hardDomainConceptKey(proj.def.key)]: [spec.domain],
        authors: authorsPicked,
        key_phrases: phrasesPicked,
        organizations: orgsPicked,
        locations: locsPicked,
        countries: [countryPicked],
      };
      if (def.hasAviation) {
        taxonomyValues.airports = pickN(def.airports, 2);
        taxonomyValues.airlines = pickN(def.airlines, 2);
      }

      const locationHash = sha256Hex(
        `${orgId}|${proj.id}|${spec.serial}|${spec.domain}|${spec.publishedAt.toISOString()}|${title}`,
      );
      if (seenHashes.has(locationHash)) {
        throw new Error(`Duplicate locationHash generated for ${spec.serial} — aborting seed.`);
      }
      seenHashes.add(locationHash);

      docs.push({
        orgId,
        projectId: proj.id,
        title,
        summary,
        body,
        domain: spec.domain,
        sourceType: spec.sourceType,
        publishedAt: spec.publishedAt,
        authors: authorsPicked,
        taxonomyValues,
        tagIds: [],
        assets: [],
        locationHash,
        hidden: spec.hidden,
        hiddenAt: spec.hidden ? spec.publishedAt : null,
        hiddenBy: null,
        ingestedAt: spec.publishedAt,
      });
    }

    let createdCount = 0;
    for (let offset = 0; offset < docs.length; offset += ARTICLE_INSERT_CHUNK) {
      const chunk = docs.slice(offset, offset + ARTICLE_INSERT_CHUNK);
      const created = await ArticleModel.insertMany(chunk, { ordered: false });
      createdCount += created.length;
      for (const doc of created) {
        insertedArticles.push({
          _id: doc._id.toString(),
          projectKey: proj.def.key,
          domain: doc.domain,
          sourceType: doc.sourceType,
          hidden: doc.hidden,
          publishedAt: doc.publishedAt,
          taxonomyValues: doc.taxonomyValues as Record<string, string[]>,
        });
        esDocs.push({
          id: doc._id.toString(),
          orgId,
          projectId: proj.id,
          title: doc.title,
          summary: doc.summary,
          body: doc.body,
          domain: doc.domain,
          sourceType: doc.sourceType,
          publishedAt: doc.publishedAt.toISOString(),
          authors: doc.authors,
          taxonomyValues: doc.taxonomyValues as Record<string, string[]>,
          tagIds: [],
          locationHash: doc.locationHash,
          hidden: doc.hidden,
          createdAt: (doc.createdAt ?? doc.publishedAt).toISOString(),
        });
      }
      process.stdout.write(
        `\r  + ${def.name}: ${Math.min(offset + chunk.length, docs.length).toLocaleString()}/${docs.length.toLocaleString()} inserted`,
      );
    }
    console.log(`\n  + ${createdCount.toLocaleString()} articles inserted for ${def.name}`);
  }

  console.log(`  Indexing ${esDocs.length.toLocaleString()} articles into Elasticsearch ...`);
  await bulkIndexArticles(orgId, esDocs);
  await esClient.indices.refresh({ index: getOrgIndexName(orgId) });
  console.log(`  Indexed ${esDocs.length.toLocaleString()} articles; refreshed index.`);

  // ---------------------------------------------------------------------------------
  // 8. Global settings
  // ---------------------------------------------------------------------------------
  console.log('\n[8/12] Updating global settings ...');
  await api('PATCH', '/settings/global', {
    token: adminToken,
    body: {
      maxSnapshotArticles: 200,
      msTeams: {
        maxArticlesPerShare: 25,
        defaultBulkMessage: 'Sharing today’s key coverage from Meridian Media Intelligence.',
      },
      articleFieldMapping: {
        locationConceptKey: 'locations',
      },
    },
  });
  console.log('  Global settings updated.');

  // ---------------------------------------------------------------------------------
  // 9. User tags
  // ---------------------------------------------------------------------------------
  console.log('\n[9/12] Creating user tags ...');

  interface TagDef {
    name: string;
    groupKey: string;
    creatorEmail: string;
    isPrivate: boolean;
  }
  const TAG_DEFS: TagDef[] = [
    { name: 'Breaking', groupKey: 'comms', creatorEmail: 'analyst.comms@meridian.dev', isPrivate: false },
    { name: 'Follow-Up Needed', groupKey: 'exec', creatorEmail: 'analyst.exec@meridian.dev', isPrivate: false },
    { name: 'Verified', groupKey: 'market', creatorEmail: 'publisher@meridian.dev', isPrivate: false },
    { name: 'High Impact', groupKey: 'risk', creatorEmail: 'analyst.compliance@meridian.dev', isPrivate: false },
    { name: 'Needs Review', groupKey: 'comms', creatorEmail: 'groupadmin.comms@meridian.dev', isPrivate: false },
    { name: 'Archived', groupKey: 'risk', creatorEmail: 'groupadmin.risk@meridian.dev', isPrivate: false },
    { name: 'Internal - Do Not Cite', groupKey: 'risk', creatorEmail: 'analyst.compliance@meridian.dev', isPrivate: true },
    { name: 'Compliance Flag', groupKey: 'risk', creatorEmail: 'groupadmin.risk@meridian.dev', isPrivate: true },
  ];

  const tagIdByName = new Map<string, string>();
  for (const tdef of TAG_DEFS) {
    const creator = usersByEmail.get(tdef.creatorEmail);
    if (!creator) throw new Error(`Unknown tag creator ${tdef.creatorEmail}`);
    const token = await tokenFor(tdef.creatorEmail, creator.password);
    const tag = await api<{ id: string }>('POST', '/user-tags', {
      token,
      body: { name: tdef.name, isPrivate: tdef.isPrivate },
    });
    tagIdByName.set(tdef.name, tag.id);
    console.log(`  + "${tdef.name}" (${tdef.isPrivate ? 'private' : 'public'}) owned by ${(groups[tdef.groupKey] as GroupRuntime).def.name}, created by ${tdef.creatorEmail}`);
  }

  console.log('  Publishing 2 public tags ...');
  // Analyst holds user-tags:manage but NOT user-tags:publish (see SYSTEM_ROLE_PERMISSIONS) —
  // publishing requires Publisher / User Group Admin / Application Admin. "Breaking" was
  // created by an Analyst (analyst.comms), so it must be published by someone else who
  // holds user-tags:publish scoped to its owner group (groupadmin.comms qualifies).
  // "Verified" was created by the Publisher user, who already holds user-tags:publish.
  const PUBLISH_AS: Record<string, string> = {
    Breaking: 'groupadmin.comms@meridian.dev',
    Verified: 'publisher@meridian.dev',
  };
  for (const name of ['Breaking', 'Verified']) {
    const tagId = tagIdByName.get(name);
    const publisherEmail = PUBLISH_AS[name];
    if (!tagId || !publisherEmail) continue;
    const publisherUser = usersByEmail.get(publisherEmail);
    if (!publisherUser) continue;
    const token = await tokenFor(publisherEmail, publisherUser.password);
    await api('POST', `/user-tags/${tagId}/publish`, { token });
    console.log(`  + published "${name}" (by ${publisherEmail})`);
  }

  console.log('  Sharing "High Impact" (Risk & Compliance) into Corporate Communications with canUse ...');
  {
    const tagId = tagIdByName.get('High Impact');
    const groupAdminRisk = usersByEmail.get('groupadmin.risk@meridian.dev');
    if (tagId && groupAdminRisk) {
      const token = await tokenFor('groupadmin.risk@meridian.dev', groupAdminRisk.password);
      await api('POST', `/user-tags/${tagId}/share`, {
        token,
        body: { grants: [{ groupId: (groups.comms as GroupRuntime).id, canUse: true, canDelete: false }] },
      });
      console.log('  + shared.');
    }
  }

  console.log('  Bulk-applying tags to articles ...');
  async function bulkApplyTag(tagName: string, projectKey: string, count: number, applierEmail: string): Promise<void> {
    const tagId = tagIdByName.get(tagName);
    if (!tagId) return;
    const applier = usersByEmail.get(applierEmail);
    if (!applier) return;
    const token = await tokenFor(applierEmail, applier.password);
    const candidates = insertedArticles.filter((a) => a.projectKey === projectKey && !a.hidden);
    const chosen = pickN(candidates, Math.min(count, candidates.length)).map((a) => a._id);
    if (chosen.length === 0) return;
    await api('POST', '/user-tags/bulk-apply', { token, body: { articleIds: chosen, tagId } });
    console.log(`  + applied "${tagName}" to ${chosen.length} articles (${projectKey})`);
  }
  await bulkApplyTag('Breaking', 'reputation', 150, 'analyst.comms@meridian.dev');
  await bulkApplyTag('Breaking', 'policy', 80, 'analyst.comms@meridian.dev');
  await bulkApplyTag('Follow-Up Needed', 'financial', 120, 'analyst.exec@meridian.dev');
  await bulkApplyTag('Verified', 'aviation', 100, 'publisher@meridian.dev');
  await bulkApplyTag('High Impact', 'financial', 100, 'analyst.compliance@meridian.dev');
  await bulkApplyTag('Needs Review', 'reputation', 60, 'groupadmin.comms@meridian.dev');
  await bulkApplyTag('Archived', 'policy', 50, 'groupadmin.risk@meridian.dev');
  await bulkApplyTag('Internal - Do Not Cite', 'financial', 40, 'analyst.compliance@meridian.dev');

  // ---------------------------------------------------------------------------------
  // 10. Saved searches / channels
  // ---------------------------------------------------------------------------------
  console.log('\n[10/12] Creating saved searches / channels ...');

  function baseFilters(overrides: Partial<FilterPanelState>): FilterPanelState {
    return { ...EMPTY_FILTER_PANEL_STATE, ...overrides };
  }

  const savedSearchIds: Record<string, string> = {};

  // #1 Dynamic — Financial Watch, 30-day pulse, owned by Risk & Compliance
  {
    const creator = usersByEmail.get('analyst.compliance@meridian.dev');
    if (!creator) throw new Error('missing analyst.compliance');
    const token = await tokenFor('analyst.compliance@meridian.dev', creator.password);
    const financialOrgValue = pick(PROJECT_DEFS.find((p) => p.key === 'financial')!.organizations);
    const filters = baseFilters({
      projectIds: [(projects.financial as ProjectRuntime).id],
      dateFilter: { mode: 'lastNDays', lastNDays: 30 },
      taxonomyValues: { organizations: [financialOrgValue] },
    });
    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: { groupId: (groups.risk as GroupRuntime).id, name: 'Financial Watch — 30 Day Pulse', type: 'dynamic', filters },
    });
    savedSearchIds.financialWatch = ss.id;
    console.log('  + Financial Watch — 30 Day Pulse (dynamic)');
  }

  // #2 Dynamic — Reputation Risk Alerts, Advanced Search with 2 groups AND'd
  {
    const creator = usersByEmail.get('analyst.compliance@meridian.dev');
    if (!creator) throw new Error('missing analyst.compliance');
    const token = await tokenFor('analyst.compliance@meridian.dev', creator.password);
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [
        {
          id: randomUUID(),
          conditions: [
            {
              id: randomUUID(),
              mode: 'taxonomy',
              conceptKey: 'key_phrases',
              values: ['crisis communications', 'brand reputation'],
              matchLogic: 'any',
              operatorToNext: 'AND',
            },
          ],
          operatorToNext: 'AND',
        },
        {
          id: randomUUID(),
          conditions: [
            { id: randomUUID(), mode: 'text', values: ['reputation'], matchLogic: 'any', operatorToNext: 'AND' },
          ],
          operatorToNext: 'AND',
        },
      ],
    };
    const filters = baseFilters({
      projectIds: [(projects.reputation as ProjectRuntime).id],
      advancedSearch,
    });
    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: { groupId: (groups.risk as GroupRuntime).id, name: 'Reputation Risk Alerts', type: 'dynamic', filters },
    });
    savedSearchIds.reputationRisk = ss.id;
    console.log('  + Reputation Risk Alerts (dynamic, advanced search)');
  }

  // #3 Dynamic — Aviation Ops Watch, owned by Market Research Desk
  {
    const creator = usersByEmail.get('analyst.market@meridian.dev');
    if (!creator) throw new Error('missing analyst.market');
    const token = await tokenFor('analyst.market@meridian.dev', creator.password);
    const airlineValue = pick(AVIATION_AIRLINES);
    const filters = baseFilters({
      projectIds: [(projects.aviation as ProjectRuntime).id],
      taxonomyValues: { airlines: [airlineValue] },
    });
    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: { groupId: (groups.market as GroupRuntime).id, name: 'Aviation Ops Watch', type: 'dynamic', filters },
    });
    savedSearchIds.aviationOps = ss.id;
    console.log('  + Aviation Ops Watch (dynamic)');
  }

  // #4 Snapshot — Policy Snapshot, owned by Corporate Communications — must stay ≤ snapshot cap
  {
    const creator = usersByEmail.get('analyst.comms@meridian.dev');
    if (!creator) throw new Error('missing analyst.comms');
    const token = await tokenFor('analyst.comms@meridian.dev', creator.password);
    const policyDef = PROJECT_DEFS.find((p) => p.key === 'policy')!;
    const policyOrgValue = pick(policyDef.organizations);
    const policyDomain = pick(policyDef.domains);
    const policyCountry = pick(policyDef.countries);

    // At 10k scale a single-org filter alone often exceeds the snapshot cap (~200). Try
    // progressively tighter date/domain constraints until we land in (0, 190].
    const snapshotCandidates: FilterPanelState[] = [
      baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        taxonomyValues: { organizations: [policyOrgValue] },
        dateFilter: { mode: 'lastNDays', lastNDays: 3 },
      }),
      baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        taxonomyValues: { organizations: [policyOrgValue] },
        dateFilter: { mode: 'lastNDays', lastNDays: 7 },
      }),
      baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        taxonomyValues: {
          organizations: [policyOrgValue],
          [hardDomainConceptKey('policy')]: [policyDomain],
        },
        dateFilter: { mode: 'lastNDays', lastNDays: 14 },
      }),
      baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        taxonomyValues: {
          organizations: [policyOrgValue],
          countries: [policyCountry],
        },
        dateFilter: { mode: 'lastNDays', lastNDays: 30 },
      }),
      baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        taxonomyValues: {
          organizations: [policyOrgValue],
          [hardDomainConceptKey('policy')]: [policyDomain],
          countries: [policyCountry],
        },
        dateFilter: { mode: 'lastNDays', lastNDays: 60 },
      }),
    ];

    let filters: FilterPanelState | null = null;
    for (const candidate of snapshotCandidates) {
      const searchResult = await api<{ total: number }>('POST', '/search', {
        token,
        body: { filters: candidate, page: 1, size: 1 },
      });
      console.log(`  Policy Snapshot candidate matches ${searchResult.total} articles (cap 200).`);
      if (searchResult.total > 0 && searchResult.total <= 190) {
        filters = candidate;
        break;
      }
    }

    if (!filters) {
      // Deterministic last resort: pin to a handful of concrete seeded serials via text query
      // so the snapshot always succeeds even if taxonomy+date combos overshoot.
      filters = baseFilters({
        projectIds: [(projects.policy as ProjectRuntime).id],
        query: 'POL-0001',
      });
      const fallbackTotal = await api<{ total: number }>('POST', '/search', {
        token,
        body: { filters, page: 1, size: 1 },
      });
      console.log(`  Policy Snapshot fallback (POL-0001 text) matches ${fallbackTotal.total} articles.`);
      if (fallbackTotal.total === 0 || fallbackTotal.total > 190) {
        throw new Error(
          `Unable to build a Policy Snapshot filter under the ${200} article cap (got ${fallbackTotal.total}).`,
        );
      }
    }

    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: {
        groupId: (groups.comms as GroupRuntime).id,
        name: 'Policy Snapshot — Recent Filings',
        type: 'snapshot',
        filters,
      },
    });
    savedSearchIds.policySnapshot = ss.id;
    console.log('  + Policy Snapshot — Recent Filings (snapshot)');
  }

  // #5 Dynamic — All Financial Coverage, owned by Executive Briefing (sharer)
  {
    const creator = usersByEmail.get('sharer@meridian.dev');
    if (!creator) throw new Error('missing sharer');
    const token = await tokenFor('sharer@meridian.dev', creator.password);
    const filters = baseFilters({ projectIds: [(projects.financial as ProjectRuntime).id] });
    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: { groupId: (groups.exec as GroupRuntime).id, name: 'All Financial Coverage', type: 'dynamic', filters },
    });
    savedSearchIds.allFinancial = ss.id;
    console.log('  + All Financial Coverage (dynamic)');
  }

  // #6 Dynamic — Executive Briefing Document Uploads Tracker
  {
    const creator = usersByEmail.get('analyst.multi@meridian.dev');
    if (!creator) throw new Error('missing analyst.multi');
    const token = await tokenFor('analyst.multi@meridian.dev', creator.password);
    const filters = baseFilters({ projectIds: [(projects.reputation as ProjectRuntime).id], sourceTypeTab: 'documents' });
    const ss = await api<{ id: string }>('POST', '/saved-searches', {
      token,
      body: { groupId: (groups.exec as GroupRuntime).id, name: 'Document Uploads Tracker', type: 'dynamic', filters },
    });
    savedSearchIds.docTracker = ss.id;
    console.log('  + Document Uploads Tracker (dynamic)');
  }

  console.log('  Exposing 2 as channels (admin) ...');
  await api('POST', `/saved-searches/${savedSearchIds.financialWatch}/expose-channel`, {
    token: adminToken,
    body: { isChannel: true, channelName: 'Financial Watch' },
  });
  await api('POST', `/saved-searches/${savedSearchIds.aviationOps}/expose-channel`, {
    token: adminToken,
    body: { isChannel: true, channelName: 'Aviation Ops' },
  });

  console.log('  Sharing "Reputation Risk Alerts" into Corporate Communications (admin) ...');
  await api('POST', `/saved-searches/${savedSearchIds.reputationRisk}/share`, {
    token: adminToken,
    body: { groupIds: [(groups.comms as GroupRuntime).id] },
  });

  console.log('  Setting "All Financial Coverage" as Executive Briefing’s default query for Financial Markets Watch (admin) ...');
  await api('PUT', `/groups/${(groups.exec as GroupRuntime).id}/default-query`, {
    token: adminToken,
    body: { projectId: (projects.financial as ProjectRuntime).id, savedSearchId: savedSearchIds.allFinancial },
  });

  console.log('  Marking channels as run (admin) ...');
  await api('POST', `/saved-searches/${savedSearchIds.financialWatch}/run`, { token: adminToken, body: { page: 1, size: 20 } });
  await api('POST', `/saved-searches/${savedSearchIds.aviationOps}/run`, { token: adminToken, body: { page: 1, size: 20 } });

  // ---------------------------------------------------------------------------------
  // 11. Insights + Dashboards
  // ---------------------------------------------------------------------------------
  console.log('\n[11/12] Creating insights and dashboards ...');

  const insightIds: Record<string, string> = {};

  async function createInsight(
    name: string,
    chartType: string,
    creatorEmail: string,
    groupKey: string,
    projectKeys: string[],
    fieldMappings: Array<{ role: string; conceptKey: string }>,
    wordCloud?: { maxWords: number; minOccurrence: number; permanentExclusions: string[]; temporaryExclusions: string[] },
  ): Promise<string> {
    const creator = usersByEmail.get(creatorEmail);
    if (!creator) throw new Error(`Unknown insight creator ${creatorEmail}`);
    const token = await tokenFor(creatorEmail, creator.password);
    const projectIds = projectKeys.map((k) => (projects[k] as ProjectRuntime).id);
    const sourceFilters = baseFilters({ projectIds, dateFilter: { mode: 'lastNDays', lastNDays: 90 } });
    const insight = await api<{ id: string }>('POST', '/insights', {
      token,
      body: {
        groupId: (groups[groupKey] as GroupRuntime).id,
        projectIds,
        name,
        chartType,
        sourceFilters,
        config: { fieldMappings, ...(wordCloud ? { wordCloud } : {}) },
      },
    });
    console.log(`  + "${name}" (${chartType}) by ${creatorEmail}`);
    return insight.id;
  }

  insightIds.coverageByCountry = await createInsight(
    'Coverage by Country',
    'bar',
    'analyst.compliance@meridian.dev',
    'risk',
    ['financial'],
    [{ role: 'category', conceptKey: 'countries' }],
  );
  insightIds.keyPhraseCloud = await createInsight(
    'Key Phrase Cloud',
    'wordCloud',
    'analyst.comms@meridian.dev',
    'comms',
    ['reputation'],
    [],
    { maxWords: 100, minOccurrence: 1, permanentExclusions: [], temporaryExclusions: [] },
  );
  insightIds.locationDomainHeat = await createInsight(
    'Location x Domain Heat',
    'heatMap',
    'analyst.market@meridian.dev',
    'market',
    ['aviation'],
    [
      { role: 'x', conceptKey: 'airports' },
      { role: 'y', conceptKey: 'airlines' },
    ],
  );
  insightIds.orgInfluenceRadar = await createInsight(
    'Org Influence Radar',
    'radar',
    'analyst.exec@meridian.dev',
    'exec',
    ['reputation', 'financial'],
    [{ role: 'axis', conceptKey: 'organizations' }],
  );
  insightIds.policyTopicsTree = await createInsight(
    'Policy Topics Tree',
    'treeMap',
    'groupadmin.comms@meridian.dev',
    'comms',
    ['policy'],
    [{ role: 'category', conceptKey: 'key_phrases' }],
  );

  console.log('  Creating dashboards (admin) ...');
  const dash1 = await api<{ id: string }>('POST', '/dashboards', {
    token: adminToken,
    body: { groupId: (groups.risk as GroupRuntime).id, projectId: (projects.financial as ProjectRuntime).id, name: 'Risk & Compliance Overview' },
  });
  await api('PUT', `/dashboards/${dash1.id}`, {
    token: adminToken,
    body: { insightIds: [insightIds.coverageByCountry, insightIds.orgInfluenceRadar] },
  });
  await api('PUT', `/dashboards/${dash1.id}/layout`, {
    token: adminToken,
    body: {
      layout: [
        { insightId: insightIds.coverageByCountry, x: 0, y: 0, w: 2, h: 2 },
        { insightId: insightIds.orgInfluenceRadar, x: 2, y: 0, w: 2, h: 2 },
      ],
    },
  });
  console.log('  + Risk & Compliance Overview (2 insights)');

  const dash2 = await api<{ id: string }>('POST', '/dashboards', {
    token: adminToken,
    body: { groupId: (groups.comms as GroupRuntime).id, projectId: (projects.reputation as ProjectRuntime).id, name: 'Editorial Insights Hub' },
  });
  await api('PUT', `/dashboards/${dash2.id}`, {
    token: adminToken,
    body: { insightIds: [insightIds.keyPhraseCloud, insightIds.policyTopicsTree, insightIds.locationDomainHeat] },
  });
  await api('PUT', `/dashboards/${dash2.id}/layout`, {
    token: adminToken,
    body: {
      layout: [
        { insightId: insightIds.keyPhraseCloud, x: 0, y: 0, w: 2, h: 2 },
        { insightId: insightIds.policyTopicsTree, x: 2, y: 0, w: 2, h: 2 },
        { insightId: insightIds.locationDomainHeat, x: 0, y: 2, w: 4, h: 2 },
      ],
    },
  });
  console.log('  + Editorial Insights Hub (3 insights)');

  // ---------------------------------------------------------------------------------
  // 12. Entity mapping
  // ---------------------------------------------------------------------------------
  console.log('\n[12/12] Syncing and mapping entity-mapping entries ...');
  const mapping = await api<{
    entries: Array<{ id: string; upstreamType: string; upstreamName: string }>;
  }>('POST', '/entity-mapping/sync', { token: adminToken });
  console.log(`  Synced ${mapping.entries.length} entries.`);

  const projectEntry = mapping.entries.find((e) => e.upstreamType === 'project' && e.upstreamName === (projects.aviation as ProjectRuntime).def.name);
  if (projectEntry) {
    await api('PUT', `/entity-mapping/${projectEntry.id}`, {
      token: adminToken,
      body: { localType: 'project', localId: (projects.aviation as ProjectRuntime).id },
    });
    console.log(`  + mapped project entry "${projectEntry.upstreamName}"`);
  }
  const conceptEntry = mapping.entries.find((e) => e.upstreamType === 'concept' && e.upstreamName === 'Organizations');
  if (conceptEntry) {
    const orgConceptId = (projects.financial as ProjectRuntime).concepts.find((c) => c.key === 'organizations')?.id;
    if (orgConceptId) {
      await api('PUT', `/entity-mapping/${conceptEntry.id}`, {
        token: adminToken,
        body: { localType: 'concept', localId: orgConceptId },
      });
      console.log(`  + mapped concept entry "${conceptEntry.upstreamName}"`);
    }
  }
  const sourceEntry = mapping.entries.find((e) => e.upstreamType === 'source' && e.upstreamName === 'reuters-wire.example');
  if (sourceEntry) {
    await api('PUT', `/entity-mapping/${sourceEntry.id}`, {
      token: adminToken,
      body: { localType: 'source', localId: 'reuters-wire.example' },
    });
    console.log(`  + mapped source entry "${sourceEntry.upstreamName}"`);
  }

  // ---------------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------------
  console.log('\n=== Verification ===');

  const counts = {
    organizations: await OrganizationModel.countDocuments({ _id: orgId }),
    projects: await ProjectModel.countDocuments({ orgId }),
    concepts: await ConceptModel.countDocuments({ orgId }),
    groups: await GroupModel.countDocuments({ orgId }),
    users: await UserModel.countDocuments({ orgId }),
    articles: await ArticleModel.countDocuments({ orgId }),
    articlesHidden: await ArticleModel.countDocuments({ orgId, hidden: true }),
    articlesNews: await ArticleModel.countDocuments({ orgId, sourceType: 'news' }),
    articlesFileSystem: await ArticleModel.countDocuments({ orgId, sourceType: 'file_system' }),
    userTags: await UserTagModel.countDocuments({ orgId }),
    savedSearches: await SavedSearchModel.countDocuments({ orgId }),
    savedSearchesChannels: await SavedSearchModel.countDocuments({ orgId, isChannel: true }),
    insights: await InsightModel.countDocuments({ orgId }),
    dashboards: await DashboardModel.countDocuments({ orgId }),
  };
  console.log('Entity counts:', JSON.stringify(counts, null, 2));
  if (counts.articles !== TOTAL_ARTICLES) {
    logBug(`Expected ${TOTAL_ARTICLES} articles, found ${counts.articles}.`);
  }
  const uniqueHashes = await ArticleModel.distinct('locationHash', { orgId });
  if (uniqueHashes.length !== counts.articles) {
    logBug(
      `Duplicate locationHash detected: ${counts.articles} articles but only ${uniqueHashes.length} unique hashes.`,
    );
  } else {
    console.log(`  Unique locationHash check passed (${uniqueHashes.length.toLocaleString()}).`);
  }

  console.log('\nSearch smoke test (as analyst.compliance, Risk & Compliance group) ...');
  const complianceUser = usersByEmail.get('analyst.compliance@meridian.dev');
  if (!complianceUser) throw new Error('missing analyst.compliance for verification');
  const complianceToken = await tokenFor('analyst.compliance@meridian.dev', complianceUser.password);

  const searchResp = await api<{ total: number; hits: Array<{ domain: string }> }>('POST', '/search', {
    token: complianceToken,
    body: { filters: baseFilters({ projectIds: [(projects.financial as ProjectRuntime).id] }), page: 1, size: 20 },
  });
  console.log(`  POST /search (Financial Markets Watch, Risk & Compliance): total=${searchResp.total}, hits returned=${searchResp.hits.length}`);
  if (searchResp.total === 0) logBug('Search smoke test returned zero results for analyst.compliance on Financial Markets Watch.');

  const facetsResp = await api<{ facets: Record<string, Array<{ key: string; count: number }>>; total: number }>(
    'POST',
    '/search/facets',
    { token: complianceToken, body: { filters: baseFilters({ projectIds: [(projects.financial as ProjectRuntime).id] }) } },
  );
  const financialDomainKey = hardDomainConceptKey('financial');
  const domainFacet = facetsResp.facets[financialDomainKey] ?? [];
  console.log(`  POST /search/facets ${financialDomainKey} buckets: ${JSON.stringify(domainFacet)}`);

  const allowedFinanceDomains = new Set(GROUP_DEFS.find((g) => g.key === 'risk')!.domainGrants.financial!.allowed);
  const leaked = domainFacet.filter((b) => !allowedFinanceDomains.has(b.key));
  // Not just "nothing ungranted leaked in" — also confirm every allowed domain that actually
  // has matching articles shows a non-zero count, so a silent false-negative (an allowed
  // value wrongly suppressed to 0/missing) is caught too, not just a false-positive leak.
  const financialDomainCountsInMongo = new Map(
    insertedArticles
      .filter((a) => a.projectKey === 'financial' && !a.hidden && allowedFinanceDomains.has(a.domain))
      .reduce((map, a) => map.set(a.domain, (map.get(a.domain) ?? 0) + 1), new Map<string, number>()),
  );
  const missingAllowed = [...financialDomainCountsInMongo.keys()].filter(
    (domain) => !domainFacet.some((b) => b.key === domain && b.count > 0),
  );
  const hardFilterCheckPassed = leaked.length === 0 && domainFacet.length > 0 && missingAllowed.length === 0;
  console.log(
    hardFilterCheckPassed
      ? `  HARD-FILTER SPOT CHECK PASSED: only allowed domains [${[...allowedFinanceDomains].join(', ')}] appear in facets, and both are non-zero where expected.`
      : `  HARD-FILTER SPOT CHECK FAILED: leaked=${JSON.stringify(leaked)} missingAllowed=${JSON.stringify(missingAllowed)}`,
  );
  if (!hardFilterCheckPassed) {
    logBug(`Hard-filter grant spot check FAILED — leaked=${JSON.stringify(leaked)} missingAllowed=${JSON.stringify(missingAllowed)}`);
  }

  // Also verify hits themselves never show an ungranted domain.
  const hitDomains = new Set(searchResp.hits.map((h) => h.domain));
  const leakedHits = [...hitDomains].filter((d) => !allowedFinanceDomains.has(d));
  if (leakedHits.length > 0) {
    logBug(`Hard-filter grant spot check FAILED on search HITS — leaked domains: ${JSON.stringify(leakedHits)}`);
  } else {
    console.log(`  Search hits domains also confirmed within allowed set: ${JSON.stringify([...hitDomains])}`);
  }

  console.log('\nChannels smoke test (as analyst.compliance) ...');
  const channelsResp = await api<{ items: Array<{ name: string }> }>('GET', '/channels', { token: complianceToken });
  console.log(`  GET /channels: ${channelsResp.items.length} visible -> ${channelsResp.items.map((c) => c.name).join(', ')}`);
  if (channelsResp.items.length === 0) logBug('GET /channels returned zero channels for analyst.compliance (expected at least "Financial Watch").');

  // ---------------------------------------------------------------------------------
  // Final report
  // ---------------------------------------------------------------------------------
  console.log('\n\n================= SEED COMPLETE =================');
  console.log(`Organization: ${ORG_NAME} (${orgId})`);
  console.log('\nSeeded users (email / password / roles):');
  for (const u of seededUsers) {
    console.log(`  - ${u.email} / ${u.password} ${u.temporary ? '(temporary — server-generated)' : '(chosen)'}`);
    console.log(`      ${u.roles.join('; ')}`);
  }
  console.log('\nEntity counts:', JSON.stringify(counts, null, 2));
  console.log(`\nHard-filter grant spot check: ${hardFilterCheckPassed ? 'PASSED' : 'FAILED'}`);
  if (bugs.length > 0) {
    console.log('\nBugs / issues encountered during seeding:');
    for (const b of bugs) console.log(`  - ${b}`);
  } else {
    console.log('\nNo bugs encountered while exercising the live API during seeding.');
  }
  console.log('===================================================\n');

  await sleep(100);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nSEED SCRIPT FAILED:');
  console.error(err);
  process.exit(1);
});
