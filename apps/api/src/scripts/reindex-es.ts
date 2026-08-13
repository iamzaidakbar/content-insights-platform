/**
 * Reindex all Mongo articles into Elasticsearch for every org.
 *
 * Use when Mongo has data but Elastic Cloud is empty (e.g. seed ran against local ES).
 *
 *   DOTENV_CONFIG_PATH=../../.env.prod pnpm --filter @content-insights/api exec tsx src/scripts/reindex-es.ts
 */
import mongoose from 'mongoose';

import { connectDB } from '../db/connect.js';
import {
  bulkIndexArticles,
  deleteAllArticlesForOrg,
  ensureOrgIndexExists,
  toIndexArticleParams,
} from '../lib/elasticsearch.js';
import { ArticleModel } from '../models/article.model.js';
import { OrganizationModel } from '../models/organization.model.js';

const BATCH_SIZE = 500;

async function reindexOrg(orgId: string): Promise<number> {
  await ensureOrgIndexExists(orgId);
  await deleteAllArticlesForOrg(orgId);

  const total = await ArticleModel.countDocuments({ orgId });
  let indexed = 0;

  for (let skip = 0; skip < total; skip += BATCH_SIZE) {
    const articles = await ArticleModel.find({ orgId })
      .sort({ _id: 1 })
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    const docs = articles.map((article) => toIndexArticleParams(article));

    await bulkIndexArticles(orgId, docs);
    indexed += docs.length;
    process.stdout.write(`\r  ${indexed.toLocaleString()}/${total.toLocaleString()} indexed`);
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
    console.log(`Reindexing org ${org.name ?? orgId} (${orgId})…`);
    const count = await reindexOrg(orgId);
    console.log(`  Done: ${count.toLocaleString()} articles`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
