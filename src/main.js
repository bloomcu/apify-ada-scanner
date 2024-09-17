import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = await Actor.getInput(); // The parameters you passed to the actor

// This assumes `input` has a boolean property called `shouldEnqueueLinks` (e.g., true or false)
const shouldEnqueueLinks = input.shouldEnqueueLinks ?? true;  // Defaults to true if not provided

const crawler = new PuppeteerCrawler({

  async requestHandler({ request, page, enqueueLinks, log }) {
      const title = await page.title();

      // Inject and execute FAE
      await page.addScriptTag({path: './vendor/main.js'});
      const results = await page.evaluate(()=>executeTest());

      // Store the results
      await Dataset.pushData({
          title: title,
          url: request.loadedUrl,
          results: results,
      })

      // Log anything that might be useful to see during crawling job.
      log.info(`Checking '${title}' at url: ${request.loadedUrl}`);
      log.info(`Found '${JSON.parse(results).rule_results.length}' violations`);

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
