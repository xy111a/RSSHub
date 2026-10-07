import type { Route } from '@/types';

// YouTube Music Charts 自建路由（2026-08-13 修复上游结构变更）
// 背景：RSSHub 内置 /youtube/charts 解析旧结构 contents.sectionListRenderer，
// 2026-08-12 起上游改为 singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer，
// 内置路由解析失败 → 503。此路由适配新结构（实测 200）。
// 注意：上游响应不稳定，carousel item 可能是两种结构之一：
//   - musicResponsiveListItemRenderer（单曲，含 playlistItemData.videoId）
//   - musicTwoRowItemRenderer（播放列表/合集卡片，navigationEndpoint.browseEndpoint）

const YT_KEY = 'AIzaSyDObRZBf0-JZCU1CjwPRH8cWKQ2umCqYDo';
const API = 'https://charts.youtube.com/youtubei/v1/browse';

function runText(runs: any[] | undefined): string {
    return (runs || [])
        .map((r: any) => r.text ?? '')
        .join('')
        .trim();
}

async function fetchChart(country: string) {
    const body = {
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240304.01.00' } },
        query: `chart_params_type=WEEK&perspective=CHART&flags=viral_video_chart&selected_chart=TRACKS&chart_params_id=weekly:0:0${country ? `:${country}` : ''}`,
    };
    const res = await fetch(`${API}?alt=json&key=${YT_KEY}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error('charts API http ' + res.status);
    }
    return res.json();
}

export const route: Route = {
    path: '/youtube-charts/:country?',
    name: 'YouTube Music Charts (自建适配版)',
    maintainers: ['huajun'],
    example: '/cdp/youtube-charts',
    categories: ['social-media'],
    parameters: { country: 'Country Code, default global' },
    description: 'YouTube Music 排行榜，适配 2026-08 上游结构变更（原内置路由 503）。',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const country = (ctx.req.param('country') || '').toLowerCase();
        const data = await fetchChart(country);
        const tabs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs;
        const slr = tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
        const sections = slr?.contents || [];

        const items: any[] = [];
        const seen = new Set<string>();
        for (const section of sections) {
            const shelf = section.musicCarouselShelfRenderer;
            if (!shelf) continue;
            for (const c of shelf.contents || []) {
                // 结构 1: 单曲列表项
                const r1 = c.musicResponsiveListItemRenderer;
                if (r1) {
                    const videoId = r1.playlistItemData?.videoId;
                    if (!videoId) continue;
                    const guid = `youtube:charts:video:${videoId}`;
                    if (seen.has(guid)) continue;
                    seen.add(guid);
                    const title = runText(r1.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || '(untitled)';
                    const author = runText(r1.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
                    items.push({
                        title: author ? `${title} - ${author}` : title,
                        link: `https://www.youtube.com/watch?v=${videoId}`,
                        guid,
                        author,
                    });
                    continue;
                }
                // 结构 2: 播放列表/合集卡片
                const r2 = c.musicTwoRowItemRenderer;
                if (r2) {
                    const title = runText(r2.title?.runs) || '(untitled)';
                    const subtitle = runText(r2.subtitle?.runs);
                    const browseId = r2.navigationEndpoint?.browseEndpoint?.browseId;
                    const guid = `youtube:charts:browse:${browseId || title}`;
                    if (seen.has(guid)) continue;
                    seen.add(guid);
                    const link = browseId ? `https://music.youtube.com/browse/${browseId}` : 'https://charts.youtube.com/';
                    items.push({
                        title: subtitle ? `${title} - ${subtitle}` : title,
                        link,
                        guid,
                        author: subtitle || '',
                    });
                }
            }
        }

        return {
            title: `YouTube Music Charts${country ? ` (${country})` : ''}`,
            link: 'https://charts.youtube.com/',
            item: items.slice(0, 50),
        };
    },
};
