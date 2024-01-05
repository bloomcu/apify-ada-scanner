import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();
const input = await Actor.getInput(); // The parameters you passed to the actor

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
      await enqueueLinks();
  },

  maxRequestsPerCrawl: 3,
});

await crawler.run(input.startUrls);
// await crawler.run(['https://vetframe.com']);

await Actor.exit();
