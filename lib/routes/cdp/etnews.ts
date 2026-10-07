import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// ETNews (韩国电子新闻): https://www.etnews.com/
// 首页文章: <a href="/20260807000287">SK하이닉스, 용인 Y2·청주 M17에 54조원 투자</a>
// 链接格式: /YYYYMMDDxxxxx

export const route: Route = {
    path: '/etnews',
    name: 'ETNews (韩国电子新闻)',
    maintainers: ['huajun'],
    example: '/cdp/etnews',
    categories: ['news'],
    parameters: {
        limit: 'Maximum number of articles to return (default 20)',
    },
    description: '韩国电子新闻（전자신문）主页新闻，覆盖半导体/IT/消费电子。抓取主页 HTML 解析，无需登录。',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const limit = Math.min(parseInt(ctx.req.query('limit') || '20', 10) || 20, 50);
        const url = 'https://www.etnews.com/';
        const html = await ofetch(url, { responseType: 'text' });
        const $ = load(html);

        const items: any[] = [];
        const seen = new Set<string>();

        // 文章链接: /20260807000287 (10位以上数字)
        $('a').each((_, el) => {
            if (items.length >= limit) return;
            const href = $(el).attr('href') || '';
            const m = href.match(/^\/(\d{8,})\d*$/);
            if (!m) return;
            const title = $(el).text().trim();
            if (!title || title.length < 5) return;
            const fullUrl = 'https://www.etnews.com' + href;
            if (seen.has(fullUrl)) return;
            seen.add(fullUrl);

            // 从链接提取日期: /20260807000287 -> 2026-08-07
            const dm = href.match(/^\/(\d{4})(\d{2})(\d{2})/);
            let pubDate: string | undefined;
            if (dm) {
                pubDate = `${dm[1]}-${dm[2]}-${dm[3]}T00:00:00+09:00`;
            }

            items.push({
                title,
                link: fullUrl,
                pubDate: pubDate ? parseDate(pubDate) : undefined,
            });
        });

        return {
            title: 'ETNews Korea',
            link: 'https://www.etnews.com/',
            description: '韩国电子新闻 ETNews',
            allowEmpty: true,
            item: items,
        };
    },
};
