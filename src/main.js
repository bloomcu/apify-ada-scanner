// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();
console.log('Input: ', input);

const crawler = new PuppeteerCrawler({
    async requestHandler({ request, page, enqueueLinks, log }) {
        const title = await page.title();

        log.info(page);
        log.info(`Title of ${request.loadedUrl} is '${title}'`);

        await enqueueLinks();
    },

    maxRequestsPerCrawl: 200,
});

// await crawler.run(input.startUrls);
await crawler.run(['https://vetframe.com']);

await Actor.exit();
