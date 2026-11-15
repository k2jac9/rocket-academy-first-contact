import { MongoClient } from 'mongodb';
import { readConfig } from '../server/config.ts';
import { ATLAS_CLIENT_OPTIONS } from '../server/atlasConnection.ts';
import {
  SEARCH_COLLECTION,
  SEARCH_INDEX,
  SEARCH_MODEL,
  SEARCH_DEFINITION,
  syncEpisodeSearch,
  episodeSearchStatus,
  searchEpisodes,
  parseEpisodeSearch,
} from '../server/episodeSearch.ts';

// Explicit operator command. Application startup never provisions a billable search index.
const [command = 'status', ...rest] = process.argv.slice(2);
if (!['status', 'sync', 'activate', 'query'].includes(command) || (command !== 'query' && rest.length))
  throw new Error('Usage: atlas_search.ts status|sync|activate|query [search phrase]');
const config = readConfig();
// Index provisioning can outlast the regular API socket deadline; this operator-only wait is bounded.
const client = new MongoClient(config.mongodbUri, { ...ATLAS_CLIENT_OPTIONS, socketTimeoutMS: 30_000 });
try {
  await client.connect();
  const db = client.db(config.mongodbDb);
  if (command === 'activate' || command === 'sync') {
    const sync = await syncEpisodeSearch(db);
    console.log(JSON.stringify({ projection: sync }));
    if (command === 'activate') {
      const indexes = await db.collection(SEARCH_COLLECTION).listSearchIndexes().toArray();
      if (!indexes.some((i) => i.name === SEARCH_INDEX)) {
        try {
          await db.collection(SEARCH_COLLECTION).createSearchIndex({
            name: SEARCH_INDEX,
            type: 'vectorSearch',
            definition: SEARCH_DEFINITION,
          });
        } catch (error) {
          // Creation may succeed before its acknowledgement is lost. Reconcile before retrying.
          const found = await db.collection(SEARCH_COLLECTION).listSearchIndexes(SEARCH_INDEX).toArray();
          if (!found.length) throw error;
        }
        console.log(JSON.stringify({ created: SEARCH_INDEX, model: SEARCH_MODEL }));
      }
    }
  }
  if (command === 'query') {
    const result = await searchEpisodes(db, parseEpisodeSearch({ query: rest.join(' '), limit: 5 }));
    console.log(
      JSON.stringify({
        ...result,
        episodes: result.episodes.map((e) => ({
          site: e.site,
          body: e.body,
          termination: e.termination,
          score: e.score,
        })),
      }),
    );
  } else console.log(JSON.stringify(await episodeSearchStatus(db)));
} catch (error) {
  const e = error as { code?: unknown; name?: string; message?: string };
  console.error(
    JSON.stringify({
      ok: false,
      code: e.code ?? null,
      name: e.name,
      // Classify known setup errors; never print connection strings or arbitrary provider messages.
      reason: /autoEmbed|automated embedding/i.test(e.message ?? '')
        ? 'Automated Embedding configuration rejected; check Atlas feature access and index definition.'
        : 'Search operation failed. Check Atlas access and search configuration.',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
