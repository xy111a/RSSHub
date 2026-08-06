import type { Route } from '@/types';
import { withPage, twitterFetch, twitterToItems } from './_engine.mjs';

export const route: Route = {
    path: '/twitter/user/:id',
    name: 'Twitter / X User Timeline (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/twitter/user/sama',
    categories: ['social-media'],
    parameters: {
        id: 'Twitter / X screen name, with or without the leading @',
        limit: 'Maximum number of tweets to return (default 20)',
        replies: 'Set to `true` to include replies (UserTweetsAndReplies)',
    },
    description:
        'Drives the already-logged-in chrome2 browser over CDP to fetch a user timeline. ' +
        'No API key needed — it reuses the browser session cookies and the live guest bearer.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const id = ctx.req.param('id').replace(/^@/, '');
        const limit = parseInt(ctx.req.query('limit') || '20', 10) || 20;
        const withReplies = ctx.req.query('replies') === 'true' || ctx.req.query('replies') === '1';
        const result = await withPage('https://x.com', twitterFetch, { screenName: id, limit, withReplies });
        return {
            title: result.name ? `Twitter @${id} (${result.name})` : `Twitter @${id}`,
            link: result.profileUrl,
            description: `Latest tweets from @${id}`,
            allowEmpty: true,
            item: twitterToItems(result),
        };
    },
};
