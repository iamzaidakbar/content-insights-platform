/**
 * Upsert every Mongo article into Elasticsearch, including tagIds.
 *
 * Unlike reindex-es.ts this does not wipe the index first — it overwrites docs in
 * place so existing search stays available if a batch fails. Use this as the one-time
 * production migration when Articles exist but user-tag filters/counts are wrong.
 *
 * From a workstation (prod env):
 *   DOTENV_CONFIG_PATH=.env.prod pnpm --filter @content-insights/api sync-tag-ids-es
 *
 * From a running API pod (env already injected):
 *   kubectl -n cip exec deploy/cip-api -- node dist/scripts/sync-tag-ids-es.js
 */
import mongoose from 'mongoose';

import { connectDB } from '../db/connect.js';
import { bulkIndexArticles, ensureOrgIndexExists, toIndexArticleParams } from '../lib/elasticsearch.js';
import { ArticleModel } from '../models/article.model.js';
import { OrganizationModel } from '../models/organization.model.js';

const BATCH_SIZE = 500;

async function syncOrg(orgId: string): Promise<number> {
  await ensureOrgIndexExists(orgId);

  const total = await ArticleModel.countDocuments({ orgId });
  let indexed = 0;

  for (let skip = 0; skip < total; skip += BATCH_SIZE) {
    const articles = await ArticleModel.find({ orgId })
      .sort({ _id: 1 })
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    const isLast = skip + BATCH_SIZE >= total;
    await bulkIndexArticles(orgId, articles.map(toIndexArticleParams), isLast ? { refresh: true } : undefined);
    indexed += articles.length;
    process.stdout.write(`\r  ${indexed.toLocaleString()}/${total.toLocaleString()} synced`);
  }

  process.stdout.write('\n');
  return indexed;
}

async function main(): Promise<void> {
  await connectDB();
  const orgs = await OrganizationModel.find({}, { name: 1 }).lean();
  if (orgs.length === 0) {
    throw new Error('No organizations found');
  }

  for (const org of orgs) {
    const orgId = org._id.toString();
    console.log(`Syncing articles (with tagIds) for org ${org.name ?? orgId} (${orgId})…`);
    const count = await syncOrg(orgId);
    console.log(`  Done: ${count.toLocaleString()} articles`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
