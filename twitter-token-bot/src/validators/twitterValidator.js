// src/validators/twitterValidator.js
const axios = require('axios');
const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retryUtils');

class TwitterValidator {
    constructor(config = {}) {
        this.config = {
            apiKey: process.env.TWITTER_API_KEY || process.env.X_API_KEY,
            apiSecret: process.env.TWITTER_API_SECRET || process.env.X_API_SECRET,
            bearerToken: process.env.TWITTER_BEARER_TOKEN || process.env.X_BEARER_TOKEN,
            timeout: config.timeout || 10000,
            maxRetries: config.maxRetries || 3,
            rateLimitDelay: config.rateLimitDelay || 60000, // 1 minute
            useEmbedMethod: config.useEmbedMethod !== false, // Default to true
            ...config
        };

        this.rateLimitedUntil = 0;
        this.requestCount = 0;
        this.lastResetTime = Date.now();
        
        // Initialize axios instance
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
    }

    async validateEngagement(twitterUrl) {
        if (!twitterUrl) {
            logger.debug('No Twitter URL provided');
            return null;
        }

        try {
            // Extract tweet ID from URL
            const tweetId = this.extractTweetId(twitterUrl);
            if (!tweetId) {
                logger.debug(`Could not extract tweet ID from URL: ${twitterUrl}`);
                return null;
            }

            logger.debug(`Validating engagement for tweet ID: ${tweetId}`);

            // Check rate limit
            if (this.isRateLimited()) {
                logger.warn(`Rate limited until ${new Date(this.rateLimitedUntil)}`);
                return null;
            }

            // Try multiple methods to get tweet metrics
            let metrics = null;

            // Method 1: Use embed method (no API key required)
            if (this.config.useEmbedMethod) {
                metrics = await this.getMetricsFromEmbed(tweetId);
                if (metrics) {
                    logger.debug(`Got metrics from embed method: ${JSON.stringify(metrics)}`);
                    return { link: twitterUrl, ...metrics };
                }
            }

            // Method 2: Use Twitter API v2 (requires bearer token)
            if (this.config.bearerToken) {
                metrics = await this.getMetricsFromAPI(tweetId);
                if (metrics) {
                    logger.debug(`Got metrics from API: ${JSON.stringify(metrics)}`);
                    return { link: twitterUrl, ...metrics };
                }
            }

            // Method 3: Scraping method (fallback)
            metrics = await this.getMetricsFromScraping(tweetId);
            if (metrics) {
                logger.debug(`Got metrics from scraping: ${JSON.stringify(metrics)}`);
                return { link: twitterUrl, ...metrics };
            }

            logger.warn(`Could not get metrics for tweet ${tweetId} using any method`);
            return null;

        } catch (error) {
            logger.error(`Error validating Twitter engagement for ${twitterUrl}:`, error.message);
            return null;
        }
    }

    extractTweetId(url) {
        // Handle both twitter.com and x.com URLs
        const patterns = [
            /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
            /(?:twitter\.com|x\.com)\/\w+\/statuses\/(\d+)/,
            /\/status\/(\d+)/,
            /\/statuses\/(\d+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    async getMetricsFromEmbed(tweetId) {
        try {
            const embedUrl = `https://publish.twitter.com/oembed?url=https://twitter.com/x/status/${tweetId}&omit_script=true`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(embedUrl),
                this.config.maxRetries
            );

            if (response.data && response.data.html) {
                return this.parseEmbedMetrics(response.data.html);
            }

            return null;
        } catch (error) {
            logger.debug(`Embed method failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    parseEmbedMetrics(html) {
        // This is a simplified parser - you might need to enhance based on actual HTML structure
        const metrics = {
            views: 0,
            likes: 0,
            retweets: 0,
            replies: 0
        };

        try {
            // Look for view counts (this pattern may need adjustment)
            const viewMatch = html.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*views?/i);
            if (viewMatch) {
                metrics.views = this.parseNumberString(viewMatch[1]);
            }

            // Look for like counts
            const likeMatch = html.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*likes?/i);
            if (likeMatch) {
                metrics.likes = this.parseNumberString(likeMatch[1]);
            }

            // Look for retweet counts
            const retweetMatch = html.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*retweets?/i);
            if (retweetMatch) {
                metrics.retweets = this.parseNumberString(retweetMatch[1]);
            }

        } catch (error) {
            logger.debug('Error parsing embed metrics:', error.message);
        }

        return metrics.views > 0 || metrics.likes > 0 || metrics.retweets > 0 ? metrics : null;
    }

    async getMetricsFromAPI(tweetId) {
        try {
            const url = `https://api.twitter.com/2/tweets/${tweetId}`;
            const params = {
                'tweet.fields': 'public_metrics,created_at,author_id',
                'expansions': 'author_id'
            };

            const response = await retryWithBackoff(
                () => this.httpClient.get(url, {
                    params,
                    headers: {
                        'Authorization': `Bearer ${this.config.bearerToken}`
                    }
                }),
                this.config.maxRetries
            );

            this.handleRateLimit(response.headers);

            if (response.data && response.data.data) {
                const tweet = response.data.data;
                const metrics = tweet.public_metrics;

                return {
                    views: metrics.impression_count || 0,
                    likes: metrics.like_count || 0,
                    retweets: metrics.retweet_count || 0,
                    replies: metrics.reply_count || 0,
                    quotes: metrics.quote_count || 0
                };
            }

            return null;
        } catch (error) {
            if (error.response?.status === 429) {
                this.handleRateLimitError(error.response.headers);
            }
            logger.debug(`API method failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    async getMetricsFromScraping(tweetId) {
        try {
            // This is a basic scraping approach - be careful with rate limits
            const url = `https://twitter.com/x/status/${tweetId}`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url, {
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                    }
                }),
                this.config.maxRetries
            );

            if (response.data) {
                return this.parseScrapedMetrics(response.data);
            }

            return null;
        } catch (error) {
            logger.debug(`Scraping method failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    parseScrapedMetrics(html) {
        const metrics = {
            views: 0,
            likes: 0,
            retweets: 0,
            replies: 0
        };

        try {
            // These patterns may need adjustment based on Twitter's current HTML structure
            const patterns = {
                views: /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*Views/i,
                likes: /aria-label="(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*Likes"/i,
                retweets: /aria-label="(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*Retweets"/i,
                replies: /aria-label="(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*replies"/i
            };

            for (const [key, pattern] of Object.entries(patterns)) {
                const match = html.match(pattern);
                if (match) {
                    metrics[key] = this.parseNumberString(match[1]);
                }
            }

        } catch (error) {
            logger.debug('Error parsing scraped metrics:', error.message);
        }

        return metrics.views > 0 || metrics.likes > 0 || metrics.retweets > 0 ? metrics : null;
    }

    parseNumberString(numberStr) {
        if (!numberStr || typeof numberStr !== 'string') return 0;
        
        // Remove commas and convert K/M/B suffixes
        const cleanStr = numberStr.replace(/,/g, '').toLowerCase();
        
        if (cleanStr.includes('k')) {
            return Math.floor(parseFloat(cleanStr) * 1000);
        } else if (cleanStr.includes('m')) {
            return Math.floor(parseFloat(cleanStr) * 1000000);
        } else if (cleanStr.includes('b')) {
            return Math.floor(parseFloat(cleanStr) * 1000000000);
        }
        
        return parseInt(cleanStr) || 0;
    }

    handleRateLimit(headers) {
        const remaining = headers['x-rate-limit-remaining'];
        const reset = headers['x-rate-limit-reset'];
        
        if (remaining !== undefined) {
            logger.debug(`API calls remaining: ${remaining}`);
            
            if (parseInt(remaining) < 10) {
                const resetTime = new Date(parseInt(reset) * 1000);
                logger.warn(`Approaching rate limit. Reset at: ${resetTime}`);
            }
        }
    }

    handleRateLimitError(headers) {
        const reset = headers['x-rate-limit-reset'];
        if (reset) {
            this.rateLimitedUntil = parseInt(reset) * 1000;
            logger.warn(`Rate limited until: ${new Date(this.rateLimitedUntil)}`);
        } else {
            this.rateLimitedUntil = Date.now() + this.config.rateLimitDelay;
            logger.warn(`Rate limited for ${this.config.rateLimitDelay}ms`);
        }
    }

    isRateLimited() {
        return Date.now() < this.rateLimitedUntil;
    }

    getStatus() {
        return {
            rateLimitedUntil: this.rateLimitedUntil,
            isRateLimited: this.isRateLimited(),
            requestCount: this.requestCount,
            hasApiKey: !!this.config.bearerToken,
            useEmbedMethod: this.config.useEmbedMethod
        };
    }

    // Test method to validate configuration
    async testConfiguration() {
        const testTweetId = '1234567890123456789'; // Use a known tweet ID for testing
        
        try {
            const result = await this.validateEngagement(`https://twitter.com/x/status/${testTweetId}`);
            return {
                success: !!result,
                methods: {
                    embed: this.config.useEmbedMethod,
                    api: !!this.config.bearerToken,
                    scraping: true
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = TwitterValidator;