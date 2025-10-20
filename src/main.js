// main.js
import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
const shouldEnqueueLinks = input.shouldEnqueueLinks ?? true; // default true

/**
 * ---- Normalizers: new → old shape ----
 * Keeps your convenient helpers and uses them just before Dataset.pushData().
 */
function normalizeRuleResultsToOldShape(ruleResults) {
  return (ruleResults || []).map((rr) => {
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

    // Old schema keys that may not exist in the new payload
    if (!('guideline_code' in out))      out.guideline_code = null;
    if (!('rule_group_code' in out))     out.rule_group_code = null;
    if (!('rule_group_code_nls' in out)) out.rule_group_code_nls = null;

    return out;
  });
}

function normalizeContainerToOldShape(inputPayload, { DROP_NEW_KEYS = false } = {}) {
  // Accept either the whole dataset item or the inner "results" payload, as string or object
  let payload = inputPayload;
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
  out.ruleset_id      = out.ruleset_id      ?? out.ruleset      ?? null; // NEW ruleset -> OLD ruleset_id
  out.ruleset_version = out.ruleset_version ?? out.version      ?? null; // NEW version  -> OLD ruleset_version
  out.ruleset_title   = out.ruleset_title   ?? null;                      // keep for parity
  out.ruleset_abbrev  = out.ruleset_abbrev  ?? null;                      // keep for parity
  out.markup_information = out.markup_information ?? {};

  // Normalize the per-rule array
  const arr = Array.isArray(out.rule_results)
    ? out.rule_results
    : (Array.isArray(out.allRuleResults) ? out.allRuleResults : []);
  out.rule_results = normalizeRuleResultsToOldShape(arr);

  // Optionally drop new-only meta
  if (DROP_NEW_KEYS) {
    delete out.ruleset;
    delete out.version;
    delete out.scope_filter;
    delete out.date;
    delete out.allRuleResults;
  }

  return out;
}

function normalizeForLegacyBackend(obj, {
  wrapLikeOld = false,           // set true if your backend expects {title,url,results:"..."}
  forcePlainEvalUrlEncoded = false,  // set true if legacy used unencoded URL here
  synthesizePageOrdinal = 2,     // old exports sometimes used 2 for page-level MC
} = {}) {
  const out = { ...obj };

  // 1) eval_url_encoded parity (some old exports used plain URL here)
  if (forcePlainEvalUrlEncoded) {
    out.eval_url_encoded = String(out.eval_url || '');
  }

  // 2) Ensure page-level element hits have stable identifiers/ordinals
  for (const r of out.rule_results || []) {
    for (const e of r.element_results || []) {
      if ((e.element_identifier === 'element' || !e.element_identifier) && (e.ordinal_position == null)) {
        // treat as page-level when position is missing and not a website result
        e.element_identifier = e.element_identifier === 'website' ? 'website' : 'page';
        e.ordinal_position = synthesizePageOrdinal;
      }
    }
  }

  // 3) Optionally wrap like the old container (results as a string)
  if (wrapLikeOld) {
    return {
      title: out.eval_title || '',
      url: out.eval_url || '',
      results: JSON.stringify(out),
    };
  }

  return out;
}

/**
 * ---- Crawler ----
 * Assumes you’ve bundled the exporter as: ./vendor/openA11yLegacyExport.bundle.iife.js
 * (i.e., it defines window.OpenA11yLegacyExport.run({...}))
 */
const crawler = new PuppeteerCrawler({
  maxRequestsPerCrawl: input.maxRequestsPerCrawl ?? 300,

  async requestHandler({ request, page, enqueueLinks, log }) {
    // Keep some quick console mirroring for debugging
    page.on('console', async (msg) => {
      try {
        const vals = await Promise.all(msg.args().map((a) => a.jsonValue()));
        console.log('PAGE:', msg.type().toUpperCase(), msg.text(), ...vals);
      } catch {
        console.log('PAGE:', msg.type().toUpperCase(), msg.text());
      }
    });

    // Ensure the document is settled
    await page.waitForLoadState?.('load').catch(() => {});
    const title = await page.title().catch(() => '');

    // Inject the legacy exporter (IIFE bundle)
    await page.addScriptTag({ path: './vendor/openA11yLegacyExport.bundle.iife.js' });

    // Wait for the API to exist
    await page.waitForFunction(
      () => window.OpenA11yLegacyExport && typeof window.OpenA11yLegacyExport.run === 'function',
      { timeout: 15000 }
    );

    // Evaluate in page: run exporter, stringify safely, return the string
    const resultsString = await page.evaluate(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      const safeStringify = (obj) => {
        const seen = new WeakSet();
        return JSON.stringify(
          obj,
          (k, v) => {
            if (typeof v === 'function') return undefined;
            if (v && typeof v === 'object') {
              if (seen.has(v)) return;
              seen.add(v);
            }
            return v;
          },
          2
        );
      };
      await wait(2000);
      // Use the object signature for run()
      const payload = await window.OpenA11yLegacyExport.run({
        ruleset: 'WCAG21',
        level: 'AA',
        scope: 'ALL',
      });

      return safeStringify(payload);
    });

    // Back in Node: parse and normalize to old shape
    let legacy = {};
    try {
      legacy = JSON.parse(resultsString);
    } catch (e) {
      log.exception(e, 'Failed to parse exporter JSON string');
      legacy = {};
    }

    // Force in our current URL/title in case page altered them
    legacy.eval_url = request.loadedUrl || legacy.eval_url || request.url;
    legacy.eval_title = title || legacy.eval_title || '';

    // Normalize to the exact old top-level structure your consumers expect
    legacy = normalizeContainerToOldShape(legacy, { DROP_NEW_KEYS: true });

    // Helpful counters for logs
    const countRules = Array.isArray(legacy.rule_results) ? legacy.rule_results.length : 0;
    const totalViolations = legacy.rule_results?.reduce((sum, r) => sum + (r.elements_violation || 0), 0) ?? 0;

    log.info(`Checked '${legacy.eval_title}' — rules: ${countRules}, violations: ${totalViolations}`);
    legacy = normalizeForLegacyBackend(legacy, {
      wrapLikeOld: true,              // set true only if your backend insists on the old wrapper
      forcePlainEvalUrlEncoded: false, // set true if diffs show a mismatch here
    });
    await Dataset.pushData(legacy);
    // WRITE: push the full legacy-shaped object as a dataset item
    // await Dataset.pushData(legacy);

    // Optionally, also store the raw string (uncomment if you need both)
    // await Actor.setValue(`legacy-${Date.now()}.json`, resultsString, { contentType: 'application/json; charset=utf-8' });

    if (shouldEnqueueLinks) {
      await enqueueLinks();
    } else {
      log.info(`Skipping link enqueuing for '${legacy.eval_title}'`);
    }
  },
});

// Optional: residential proxy setup
if (input.useResidentialProxy) {
  await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });
}

// Run the crawl
await crawler.run(input.startUrls);
await Actor.exit();
