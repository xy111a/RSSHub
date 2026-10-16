import Parser from 'rss-parser';
import { fetch as undiciFetch } from 'undici';

import type { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';

// Rest of World (全球南方科技报道): https://restofworld.org/
// 2026-08-10 专用适配器 v4（终版修复）：
//  1) 官方 /rss/ 有 301→302 双重跳转（/rss/→/feed/→/feed/latest/），直接抓最终地址。
//  2) ⚠️ 根因：RSSHub 应用启动时 lib/utils/request-rewriter 会把 globalThis.fetch 全局替换为
//     包装版（注入默认 UA/referer + 限流 + proxy 逻辑），路由里的全局 fetch() 实际是包装版，
//     对 restofworld.org 触发 CF 403；容器内 node/tsx 独立进程不经 patch 所以直测 200。
//     修复：显式 import undici 原生 fetch（undiciFetch），绕开全局 patch。
//  3) 走原生 fetch 自动跟随重定向，手动传浏览器 UA。
//  4) 2026-10-16 修 503：源站 XML 的 <img> src 里图片 URL 带未转义的 &（?width=380&dpr=2&crop=16:9，
//    24 处），fast-xml-parser 严格解析抛 "Invalid character in entity name" → 整条路由 503。
//    解析前先转义裸 &，合法实体（&amp; / &#160; / &#x1F;）原样保留。

// 转义未转义的 &：后面不跟「合法实体名 + ;」的 & 一律换成 &amp;
// 合法实体形式：&amp; &lt; &#160; &#x1F; —— 即 &#[0-9]+; / &#x[0-9a-fA-F]+; / &[a-zA-Z][a-zA-Z0-9]*;
const escapeBareAmp = (xml: string) => xml.replace(/&(?!(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;');

const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const route: Route = {
    path: '/restofworld',
    name: 'Rest of World (全球南方科技)',
    maintainers: ['huajun'],
    example: '/cdp/restofworld',
    categories: ['news'],
    parameters: {
        limit: 'Maximum number of items (default 20, max 50)',
    },
    description: 'Rest of World 全球南方科技报道（非洲/拉美/东南亚/南亚互联网与科技），走专用适配器收编。',
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
        const url = 'https://restofworld.org/feed/latest/';

        // undici 原生 fetch（不被 request-rewriter patch），自动跟随重定向
        const resp = await undiciFetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        });
        if (!resp.ok) {
            throw new Error(`restofworld fetch ${resp.status}`);
        }
        const xml = escapeBareAmp(await resp.text());
        const feed = await parser.parseString(xml);

        const items = (feed.items || []).slice(0, limit).map((item) => ({
            title: item.title?.trim() || '(untitled)',
            link: item.link || feed.link || url,
            pubDate: item.isoDate ? parseDate(item.isoDate) : undefined,
            description: item.contentSnippet || item.content || '',
            author: item.creator || item.author || '',
        }));

        return {
            title: feed.title || 'Rest of World',
            link: feed.link || url,
            description: feed.description || '',
            allowEmpty: true,
            item: items,
        };
    },
};
