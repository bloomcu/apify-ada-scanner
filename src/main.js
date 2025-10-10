import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = await Actor.getInput(); // The parameters you passed to the actor

// This assumes `input` has a boolean property called `shouldEnqueueLinks` (e.g., true or false)
const shouldEnqueueLinks = input.shouldEnqueueLinks ?? true;  // Defaults to true if not provided
function normalizeRuleResultsToOldShape(ruleResults) {
  
  return (ruleResults || []).map(rr => {
    const out = { ...rr };

    // Counters: results_* -> elements_*
    if ('results_passed'       in rr) out.elements_passed       = rr.results_passed;
    if ('results_violation'    in rr) out.elements_violation    = rr.results_violation;
    if ('results_warning'      in rr) out.elements_warning      = rr.results_warning;
    if ('results_failure'      in rr) out.elements_failure      = rr.results_failure;
    if ('results_manual_check' in rr) out.elements_manual_check = rr.results_manual_check;
    if ('results_hidden'       in rr) out.elements_hidden       = rr.results_hidden;

    // Details array: results -> element_results
    if ('results' in rr && !('element_results' in rr)) {
      out.element_results = rr.results;
    }

    // Optional: drop the new names if you need an exact old-only schema
    // delete out.results_passed; delete out.results_violation; delete out.results_warning;
    // delete out.results_failure; delete out.results_manual_check; delete out.results_hidden;
    // delete out.results;

    // Optional: fields missing in new — set to null to match old presence
    if (!('guideline_code' in out))   out.guideline_code = null;
    if (!('rule_group_code' in out))  out.rule_group_code = null;
    if (!('rule_group_code_nls' in out)) out.rule_group_code_nls = null;

    return out;
  });
}


function normalizeContainerToOldShape(input, { DROP_NEW_KEYS = false, STRINGIFY = false } = {}) {
  // Accept either the whole dataset item or the inner "results" payload, as string or object.
  let payload = input;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  // Some writers wrap under .results (string or object)
  let res = payload?.results ?? payload;
  if (typeof res === 'string') {
    try { res = JSON.parse(res); } catch { res = {}; }
  }
  if (!res || typeof res !== 'object') res = {};

  // Map top-level meta from new -> old
  const out = { ...res };
  out.ruleset_id      = out.ruleset_id      ?? out.ruleset      ?? null;   // NEW ruleset -> OLD ruleset_id
  out.ruleset_version = out.ruleset_version ?? out.version      ?? null;   // NEW version  -> OLD ruleset_version
  out.ruleset_title   = out.ruleset_title   ?? null;                        // old had it; keep null if unknown
  out.ruleset_abbrev  = out.ruleset_abbrev  ?? null;                        // old had it; keep null if unknown
  out.markup_information = out.markup_information ?? {};                    // ensure object

  // Normalize the per-rule array
  const arr = Array.isArray(out.rule_results)
    ? out.rule_results
    : (Array.isArray(out.allRuleResults) ? out.allRuleResults : []);
  out.rule_results = normalizeRuleResultsToOldShape(arr, { DROP_NEW_KEYS });

  // Optionally drop the new top-level keys
  if (DROP_NEW_KEYS) {
    delete out.ruleset;      // new name
    delete out.version;      // new name
    delete out.scope_filter; // new-only meta
    delete out.date;         // new-only meta
    delete out.allRuleResults;
  }

  // Return in the same style your consumers expect
  // If your old files stored `results` as a JSON string, turn it back into that.
  if (STRINGIFY) {
    return JSON.stringify(out);
  }
  return out;
}
const crawler = new PuppeteerCrawler({

  async requestHandler({ request, page, enqueueLinks, log }) {
    const title = await page.title();
    // polyfil url parse
  
    // Inject and execute FAE
    await page.addScriptTag({path: './vendor/openA11y.bundle.iife.js'});
    // Wait for the API to be ready
    // Wait for API
    await page.waitForFunction(
      () => window.openA11yForPuppeteer && typeof window.openA11yForPuppeteer.evaluate === 'function',
      { timeout: 10000 }
    );

    // Evaluate (same signature as your bookmarklet example)
    // 1) run in the page, serialize safely to a JSON string
    const resultsJson = await page.evaluate(() => {
      const safeStringify = (obj) => {
        const seen = new WeakSet();
        return JSON.stringify(
          obj,
          (k, v) => {
            if (typeof v === 'function') return undefined; // drop functions
            if (v && typeof v === 'object') { if (seen.has(v)) return; seen.add(v); }
            return v;
          },
          2
        );
      };

      const r = (window.openA11yForPuppeteer || window.openA11y)
        .evaluate('WCAG21', 'AA', 'ALL', []);

        return safeStringify(r);
      });

      // 2) back on Node side: parse and use it
      let results = JSON.parse(JSON.parse(resultsJson));
      // console.log('results keys:', Object.keys(results || {}));
      results = normalizeContainerToOldShape(results);
      results['rule_results'] = normalizeRuleResultsToOldShape(results['rule_results']);
      // console.log('results', results);
      // Store the results
      await Dataset.pushData({
          title: title,
          url: request.loadedUrl,
          results: JSON.stringify(results),
      })

      // Log anything that might be useful to see during crawling job.
      log.info(`Checking '${title}' at url: ${request.loadedUrl}`);
      const count =
        results?.rule_results?.length ??
        results?.allRuleResults?.length ??
        0;

      log.info(`Checking '${title}' at url: ${request.loadedUrl}`);
      log.info(`Found '${count}' violations`);

      // Enqueue discovered links
      // await enqueueLinks();
      if (shouldEnqueueLinks) {
        await enqueueLinks();
      } else {
          log.info(`Skipping link enqueuing for '${title}' at url: ${request.loadedUrl}`);
      }
  },

  maxRequestsPerCrawl: 300,
});

// Optionally use a residential proxy
if (input.useResidentialProxy) {
  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
  });
}

await crawler.run(input.startUrls);
// await crawler.run(['https://vetframe.com']);

await Actor.exit();
