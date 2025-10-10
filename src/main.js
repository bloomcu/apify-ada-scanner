import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = await Actor.getInput(); // The parameters you passed to the actor

// This assumes `input` has a boolean property called `shouldEnqueueLinks` (e.g., true or false)
const shouldEnqueueLinks = input.shouldEnqueueLinks ?? true;  // Defaults to true if not provided


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
        const results = JSON.parse(resultsJson);
        console.log('results keys:', Object.keys(results || {}));
      console.log('results', results);
      // Store the results
      await Dataset.pushData({
          title: title,
          url: request.loadedUrl,
          results: results,
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
