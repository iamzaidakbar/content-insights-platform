import { createHash } from 'node:crypto';

import type { Job, Worker as BullWorker } from 'bullmq';

import { indexArticle } from '../lib/elasticsearch.js';
import { logger } from '../lib/logger.js';
import { ARTICLE_INGEST_QUEUE, articleIndexQueue, isFinalAttempt, redisConnection, Worker } from '../lib/queue.js';
import { extractText, inferFileTypeFromKey } from '../lib/text-extraction.js';
import { ArticleModel, type IArticleAsset } from '../models/article.model.js';
import { ProjectModel } from '../models/project.model.js';

// ---------------------------------------------------------------------------------------
// Two independent responsibilities live in this file:
//
// (a) Re-extraction for manually-uploaded File System articles. POST /api/articles/upload
//     (article.routes.ts) already runs text extraction SYNCHRONOUSLY inline at upload time,
//     using this exact same lib/text-extraction.ts pipeline (pdfjs/mammoth/exceljs,
//     unchanged) — nothing on that path enqueues to articleIngestQueue. What this
//     queue/worker backs instead is admin.routes.ts's POST /api/admin/reindex: a bulk
//     re-extract-then-reindex of every File System article in an org (e.g. after a
//     text-normalization fix), done as retry-safe background jobs so that request returns
//     immediately instead of blocking on however many uploads the org has.
//
// (b) A simulated periodic NEWS-source ingestion feed. There is no real upstream "content
//     platform" API configured in this environment (no credentials, no endpoint) — there is
//     nothing to poll over HTTP for. The honest, in-scope option here is a small in-repo
//     fixture generator that produces a handful of plausible NEWS articles per project on a
//     timer, standing in for what a real crawler/webhook integration would otherwise
//     deliver. Swap runNewsIngestionFixture's body for a real upstream fetch once real
//     ingestion credentials exist — nothing downstream (Article shape, Elasticsearch
//     indexing) needs to change to support that.
//
//     Importantly, a later "seed data" phase does NOT need this worker (or its timer)
//     running to get Article documents into Mongo: ArticleModel.create()/insertMany() work
//     directly, independent of anything in this file. The simulator below only exists to
//     exercise the News ingestion path live/end-to-end; it is not the only way articles get
//     into the system.
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// (a) File System re-extraction
// ---------------------------------------------------------------------------------------

interface IngestJobData {
  articleId: string;
}

function findExtractableAsset(assets: IArticleAsset[]): IArticleAsset | undefined {
  return assets.find((asset) => asset.kind === 'pdf' || asset.kind === 'full_text');
}

async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { articleId } = job.data;

  const article = await ArticleModel.findById(articleId);
  if (!article) {
    return; // deleted or bogus id — nothing to do, don't retry
  }

  const asset = findExtractableAsset(article.assets);
  const fileType = asset ? inferFileTypeFromKey(asset.url) : null;

  if (asset && fileType) {
    try {
      article.body = await extractText(asset.url, fileType);
      await article.save();
    } catch (err) {
      // Rethrow so BullMQ actually retries; only give up (and index whatever body already
      // exists) on the FINAL attempt, rather than silently leaving the article un-indexed.
      if (!isFinalAttempt(job)) {
        throw err;
      }
      logger.error(
        { err, articleId },
        'Text re-extraction failed on final attempt — indexing existing body instead',
      );
    }
  }

  await articleIndexQueue.add('index', { articleId: article._id.toString(), orgId: article.orgId.toString() });
}

// In-process (same Node process as the Express server) — fine at this scope;
// a real deployment would split this into its own scaled worker process.
export function startIngestWorker(): BullWorker<IngestJobData> {
  const worker = new Worker<IngestJobData>(ARTICLE_INGEST_QUEUE, processIngestJob, {
    connection: redisConnection,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { articleId: job?.data.articleId, attemptsMade: job?.attemptsMade, err: err.message },
      'Article ingest job attempt failed',
    );
  });
  return worker;
}

// ---------------------------------------------------------------------------------------
// (b) Simulated periodic NEWS ingestion
// ---------------------------------------------------------------------------------------

interface NewsFixtureTemplate {
  title: string;
  summary: string;
  body: string;
  domain: string;
  authors: string[];
}

// A small, plausible set of "wire service"-style headlines — enough variety to exercise
// faceting/search/insights against more than one project's worth of NEWS content, without
// pretending to be a real upstream feed.
const NEWS_FIXTURE_TEMPLATES: NewsFixtureTemplate[] = [
  {
    title: 'Regional manufacturers report steady output despite supply pressures',
    summary: 'Factory activity held firm this quarter as manufacturers adapted sourcing strategies.',
    body:
      'Regional manufacturers reported steady output this quarter, according to industry survey data, ' +
      'even as several supply categories remained under pressure. Analysts attributed the resilience to ' +
      'diversified sourcing built up over the past two years and to inventory buffers held by larger firms.',
    domain: 'wire-business.example',
    authors: ['Wire Staff'],
  },
  {
    title: 'City council advances plan to expand public transit corridors',
    summary: 'A new proposal would add dedicated bus lanes along three major commuter routes.',
    body:
      'The city council voted to advance a transit expansion plan that would introduce dedicated bus lanes ' +
      'along three of the busiest commuter corridors. Supporters say the plan could cut average commute ' +
      'times significantly, while some business owners along the routes have raised concerns about ' +
      'construction disruption.',
    domain: 'metro-news.example',
    authors: ['Metro Desk'],
  },
  {
    title: 'Research group publishes findings on renewable storage efficiency',
    summary: 'New findings suggest incremental gains in grid-scale battery efficiency.',
    body:
      'A research consortium published findings this week describing incremental efficiency gains in ' +
      'grid-scale battery storage systems. The group said the improvements, while modest individually, ' +
      'compound meaningfully across a full deployment cycle and could shorten payback periods for utilities.',
    domain: 'science-wire.example',
    authors: ['Science Wire'],
  },
  {
    title: 'Quarterly earnings season opens with mixed results across sectors',
    summary: 'Early reporters showed divergent performance between consumer and industrial segments.',
    body:
      'The opening days of quarterly earnings season produced a mixed picture, with consumer-facing ' +
      'companies broadly beating expectations while several industrial firms cited softer demand abroad. ' +
      'Market reaction was muted overall, with analysts pointing to already-cautious forecasts heading in.',
    domain: 'wire-business.example',
    authors: ['Markets Desk'],
  },
  {
    title: 'Health officials issue seasonal guidance ahead of respiratory illness season',
    summary: 'Updated guidance emphasizes vaccination timing and early symptom reporting.',
    body:
      'Health officials released updated seasonal guidance ahead of the annual rise in respiratory illness ' +
      'cases, emphasizing vaccination timing for higher-risk groups and encouraging early reporting of ' +
      'symptoms to primary care providers to reduce strain on emergency services.',
    domain: 'public-health-wire.example',
    authors: ['Health Desk'],
  },
];

// Day-granularity dedupe key: re-running the simulator within the same day for the same
// org/project/template is a no-op (locationHash already exists), while a run on a new day
// produces "fresh" articles for the same templates — a simple, honest stand-in for "a real
// feed delivers new content over time" without unbounded growth on every timer tick.
function fixtureLocationHash(orgId: string, projectId: string, template: NewsFixtureTemplate, dateKey: string): string {
  return createHash('sha256').update(`news-fixture:${orgId}:${projectId}:${template.title}:${dateKey}`).digest('hex');
}

// Ingests (idempotently, per day) the fixture NEWS templates into one org/project. Returns
// the number of NEW articles actually created (0 on a repeat call the same day).
export async function runNewsIngestionFixture(
  orgId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<number> {
  const dateKey = now.toISOString().slice(0, 10);
  let created = 0;

  for (const template of NEWS_FIXTURE_TEMPLATES) {
    const locationHash = fixtureLocationHash(orgId, projectId, template, dateKey);
    const existing = await ArticleModel.exists({ orgId, locationHash });
    if (existing) continue;

    const article = await ArticleModel.create({
      orgId,
      projectId,
      title: template.title,
      summary: template.summary,
      body: template.body,
      domain: template.domain,
      sourceType: 'news',
      publishedAt: now,
      authors: template.authors,
      taxonomyValues: {},
      tagIds: [],
      assets: [],
      locationHash,
      hidden: false,
      ingestedAt: now,
    });
    created += 1;

    try {
      await indexArticle({
        id: article._id.toString(),
        orgId,
        projectId,
        title: article.title,
        summary: article.summary,
        body: article.body,
        domain: article.domain,
        sourceType: article.sourceType,
        publishedAt: article.publishedAt.toISOString(),
        authors: article.authors,
        taxonomyValues: article.taxonomyValues,
        tagIds: [],
        locationHash: article.locationHash,
        hidden: false,
        createdAt: article.createdAt.toISOString(),
      });
    } catch (err) {
      logger.error({ err, articleId: article._id.toString() }, 'Failed to index simulated news article');
    }
  }

  return created;
}

// Runs the fixture across every project in every org — the "periodic feed" fan-out.
async function runNewsIngestionFixtureForAllProjects(now: Date = new Date()): Promise<void> {
  const projects = await ProjectModel.find({}, { _id: 1, orgId: 1 });
  await Promise.all(
    projects.map((project) =>
      runNewsIngestionFixture(project.orgId.toString(), project._id.toString(), now).catch((err: unknown) => {
        logger.error(
          { err, projectId: project._id.toString(), orgId: project.orgId.toString() },
          'Simulated news ingestion failed for project',
        );
      }),
    ),
  );
}

// A plausible "periodic feed" cadence for a demo simulator — not modeling any real crawl
// schedule. Combined with the day-granularity dedupe above, this mostly just means "check
// again soon in case the calendar day rolled over."
const NEWS_SIMULATION_INTERVAL_MS = 30 * 60 * 1000;

// Starts the interval-based simulator. Callers (index.ts) own the returned handle's
// lifecycle — clearInterval it on shutdown, same as the BullMQ workers' .close().
export function startNewsIngestionSimulator(intervalMs = NEWS_SIMULATION_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runNewsIngestionFixtureForAllProjects().catch((err: unknown) => {
      logger.error({ err }, 'Simulated news ingestion cycle failed');
    });
  }, intervalMs);
  // Never keep the process alive on its own — same "owned by index.ts, not self-sustaining"
  // reasoning as the BullMQ workers.
  timer.unref();
  return timer;
}
