// src/validators/twitterValidator.js - Clean version
const axios = require('axios');
const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retryUtils');

class TwitterValidator {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 15000,
            maxRetries: config.maxRetries || 3,
            userAgents: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...config
        };

        this.rateLimitedUntil = 0;
        this.requestCount = 0;
        
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }
        });

        this.httpClient.interceptors.request.use((config) => {
            const randomUA = this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
            config.headers['User-Agent'] = randomUA;
            return config;
        });
    }

    async validateEngagement(twitterUrl) {
        if (!twitterUrl) {
            return null;
        }

        try {
            const tweetId = this.extractTweetId(twitterUrl);
            if (!tweetId) {
                return null;
            }

            if (this.isRateLimited()) {
                logger.warn(`Rate limited until ${new Date(this.rateLimitedUntil)}`);
                return null;
            }

            // Try syndication API first (most reliable)
            const metrics = await this.getMetricsFromSyndication(tweetId);
            if (metrics && (metrics.likes > 0 || metrics.retweets > 0)) {
                return { link: twitterUrl, ...metrics };
            }

            // Fallback: return minimal data
            return {
                link: twitterUrl,
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0
            };

        } catch (error) {
            logger.error(`Error validating Twitter engagement for ${twitterUrl}:`, error.message);
            return null;
        }
    }

    extractTweetId(url) {
        const patterns = [
            /(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/,
            /(?:twitter\.com|x\.com)\/[\w]+\/statuses\/(\d+)/,
            /\/status\/(\d+)/,
            /\/statuses\/(\d+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    async getMetricsFromSyndication(tweetId) {
        try {
            const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url, {
                    headers: {
                        'Referer': 'https://platform.twitter.com/',
                        'Origin': 'https://platform.twitter.com'
                    }
                }),
                this.config.maxRetries
            );

            if (response.data) {
                const data = response.data;
                
                // Log the raw data to see what fields are available
                logger.debug(`Raw Twitter API response for ${tweetId}:`, JSON.stringify(data, null, 2));
                
                const metrics = {
                    views: parseInt(data.view_count) || parseInt(data.viewCount) || 0,
                    likes: parseInt(data.favorite_count) || parseInt(data.favoriteCount) || parseInt(data.like_count) || 0,
                    retweets: parseInt(data.retweet_count) || parseInt(data.retweetCount) || parseInt(data.quote_count) || 0,
                    replies: parseInt(data.reply_count) || parseInt(data.replyCount) || parseInt(data.conversation_count) || 0
                };
                
                logger.debug(`Parsed metrics for ${tweetId}:`, metrics);
                return metrics;
            }
            return null;
        } catch (error) {
            logger.debug(`Syndication API failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    isRateLimited() {
        return Date.now() < this.rateLimitedUntil;
    }

    handleRateLimit(error) {
        if (error.response?.status === 429 || error.message.includes('rate limit')) {
            this.rateLimitedUntil = Date.now() + (5 * 60 * 1000);
            logger.warn('Rate limited for 5 minutes');
        }
    }

    getStatus() {
        return {
            rateLimitedUntil: this.rateLimitedUntil,
            isRateLimited: this.isRateLimited(),
            requestCount: this.requestCount,
            method: 'clean-validation'
        };
    }
}

module.exports = TwitterValidator;