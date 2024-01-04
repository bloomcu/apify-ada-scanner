import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

await Actor.init();
const input = await Actor.getInput(); // The parameters you passed to the actor

const crawler = new PuppeteerCrawler({

  async requestHandler({ request, page, enqueueLinks, log }) {
      const title = await page.title();
      
      // Log anything that might be useful to see during crawling job.
      log.info(`Checking '${title}' at url: ${request.loadedUrl}`);

      await enqueueLinks();
  },

  maxRequestsPerCrawl: 200,
});

// await crawler.run(input.startUrls);
await crawler.run(['https://vetframe.com']);

await Actor.exit();
