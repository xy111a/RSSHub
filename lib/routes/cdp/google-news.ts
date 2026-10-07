import Parser from 'rss-parser';

import type { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';

// Google News 区域搜索路由（收编 opencli google news 能力）
// 用法: /cdp/google-news/<region>/<urlencode(关键词)>
// region 支持: JP/KR/AE/IN/US/TH/VN/CN 等
// 示例: /cdp/google-news/JP/%E3%83%86%E3%82%AF%E3%83%8E%E3%83%AD%E3%82%B8%E3%83%BC

const REGIONS: Record<string, { hl: string; gl: string; ceid: string }> = {
    JP: { hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
    KR: { hl: 'ko', gl: 'KR', ceid: 'KR:ko' },
    AE: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
    IN: { hl: 'en', gl: 'IN', ceid: 'IN:en' },
    US: { hl: 'en', gl: 'US', ceid: 'US:en' },
    TH: { hl: 'th', gl: 'TH', ceid: 'TH:th' },
    VN: { hl: 'vi', gl: 'VN', ceid: 'VN:vi' },
    CN: { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' },
    // 新兴市场 (2026-08-10 扩展)
    BR: { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-BR' },
    MX: { hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
    NG: { hl: 'en', gl: 'NG', ceid: 'NG:en' },
    ZA: { hl: 'en', gl: 'ZA', ceid: 'ZA:en' },
    RU: { hl: 'ru', gl: 'RU', ceid: 'RU:ru' },
    TR: { hl: 'tr', gl: 'TR', ceid: 'TR:tr' },
    ID: { hl: 'id', gl: 'ID', ceid: 'ID:id' },
    GB: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
    DE: { hl: 'de', gl: 'DE', ceid: 'DE:de' },
    FR: { hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
    IL: { hl: 'en' , gl: 'IL', ceid: 'IL:en' },
    SG: { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
};

const parser = new Parser({
    timeout: 20000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
});

export const route: Route = {
    path: '/google-news/:region/:keyword',
    name: 'Google News 区域搜索 (日韩中东印度等)',
    maintainers: ['huajun'],
    example: '/cdp/google-news/JP/%E3%83%86%E3%82%AF%E3%83%8E%E3%83%AD%E3%82%B8%E3%83%BC',
    categories: ['news'],
    parameters: {
        region: '地区代码: JP/KR/AE/IN/US/TH/VN/CN',
        keyword: 'URL-encoded 搜索关键词',
        limit: 'Maximum number of items (default 10, max 30)',
    },
    description: 'Google News 区域搜索，聚合当地科技媒体，用于日韩中东印度盲区覆盖。',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const limit = Math.min(parseInt(ctx.req.query('limit') || '10', 10) || 10, 30);
        const region = (ctx.req.param('region') || '').toUpperCase();
        const rawKw = ctx.req.param('keyword') || '';
        let keyword: string;
        try {
            keyword = decodeURIComponent(rawKw);
        } catch {
            keyword = rawKw;
        }

        const loc = REGIONS[region];
        if (!loc) {
            return { title: 'Google News', link: 'https://news.google.com', allowEmpty: true, item: [] };
        }

        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${loc.hl}&gl=${loc.gl}&ceid=${loc.ceid}`;
        const feed = await parser.parseURL(feedUrl);

        const items = (feed.items || []).slice(0, limit).map((item) => ({
            title: item.title?.trim() || '(untitled)',
            link: item.link || feed.link || feedUrl,
            pubDate: item.isoDate ? parseDate(item.isoDate) : undefined,
            description: item.contentSnippet || item.content || '',
            author: item.creator || item.author || '',
        }));

        return {
            title: `Google News ${region}: ${keyword}`,
            link: feed.link || feedUrl,
            description: feed.description || '',
            allowEmpty: true,
            item: items,
        };
    },
};
