import Parser from 'rss-parser';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// Terra Brasil (巴西门户): https://www.terra.com.br/rss/
// 2026-08-10 专用适配器：rss-parser parseURL 对 terra 解析失败（HTTP 层），
// 改用 ofetch 抓文本 + parseString，绕开 rss-parser 自带 HTTP 客户端。

const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
});

export const route: Route = {
    path: '/terra',
    name: 'Terra Brasil (巴西门户)',
    maintainers: ['huajun'],
    example: '/cdp/terra',
    categories: ['news'],
    parameters: {
        limit: 'Maximum number of items (default 20, max 50)',
    },
    description: '巴西 Terra 门户 RSS（拉美宏观/财经/科技/社会），走专用适配器收编。',
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
        const url = 'https://www.terra.com.br/rss/';

        const xml = await ofetch(url, {
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            },
        });
        const feed = await parser.parseString(xml);

        const items = (feed.items || []).slice(0, limit).map((item) => ({
            title: item.title?.trim() || '(untitled)',
            link: item.link || feed.link || url,
            pubDate: item.isoDate ? parseDate(item.isoDate) : undefined,
            description: item.contentSnippet || item.content || '',
            author: item.creator || item.author || '',
        }));

        return {
            title: feed.title || 'Terra Brasil',
            link: feed.link || url,
            description: feed.description || '',
            allowEmpty: true,
            item: items,
        };
    },
};
