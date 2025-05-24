// src/validators/twitterValidator.js - Enhanced Scraping Version
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
        
        // Initialize axios instance with rotating user agents
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

        // Add request interceptor for rotating user agents
        this.httpClient.interceptors.request.use((config) => {
            const randomUA = this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
            config.headers['User-Agent'] = randomUA;
            return config;
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

            // Try multiple methods to get engagement metrics
            let metrics = null;

            // Method 1: Try X.com (new Twitter domain)
            metrics = await this.scrapeFromX(tweetId);
            if (metrics && metrics.views > 0) {
                logger.debug(`Got metrics from X.com: ${JSON.stringify(metrics)}`);
                return { link: twitterUrl, ...metrics };
            }

            // Method 2: Try Twitter.com
            metrics = await this.scrapeFromTwitter(tweetId);
            if (metrics && metrics.views > 0) {
                logger.debug(`Got metrics from Twitter.com: ${JSON.stringify(metrics)}`);
                return { link: twitterUrl, ...metrics };
            }

            // Method 3: Try embed method
            metrics = await this.getMetricsFromEmbed(tweetId);
            if (metrics && (metrics.views > 0 || metrics.likes > 0)) {
                logger.debug(`Got metrics from embed: ${JSON.stringify(metrics)}`);
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

    async scrapeFromX(tweetId) {
        try {
            const url = `https://x.com/i/web/status/${tweetId}`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url),
                this.config.maxRetries
            );

            if (response.data) {
                return this.parseMetricsFromHTML(response.data);
            }

            return null;
        } catch (error) {
            logger.debug(`X.com scraping failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    async scrapeFromTwitter(tweetId) {
        try {
            const url = `https://twitter.com/i/web/status/${tweetId}`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url),
                this.config.maxRetries
            );

            if (response.data) {
                return this.parseMetricsFromHTML(response.data);
            }

            return null;
        } catch (error) {
            logger.debug(`Twitter.com scraping failed for tweet ${tweetId}:`, error.message);
            return null;
        }
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

    parseMetricsFromHTML(html) {
        const metrics = {
            views: 0,
            likes: 0,
            retweets: 0,
            replies: 0
        };

        try {
            // Look for view counts - multiple patterns as Twitter changes frequently
            const viewPatterns = [
                /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*[Vv]iews?/gi,
                /"viewCount":"(\d+)"/gi,
                /viewcount['"]:[\s]*['"]?(\d+)/gi,
                /views?['"]\s*:\s*[\s]*['"]?(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/gi
            ];

            for (const pattern of viewPatterns) {
                const matches = [...html.matchAll(pattern)];
                if (matches.length > 0) {
                    const viewStr = matches[0][1];
                    metrics.views = this.parseNumberString(viewStr);
                    if (metrics.views > 0) break;
                }
            }

            // Look for like counts
            const likePatterns = [
                /"like_count":(\d+)/gi,
                /"favoriteCount":"(\d+)"/gi,
                /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*[Ll]ikes?/gi,
                /likes?['"]\s*:\s*[\s]*['"]?(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/gi
            ];

            for (const pattern of likePatterns) {
                const matches = [...html.matchAll(pattern)];
                if (matches.length > 0) {
                    const likeStr = matches[0][1];
                    metrics.likes = this.parseNumberString(likeStr);
                    if (metrics.likes > 0) break;
                }
            }

            // Look for retweet counts
            const retweetPatterns = [
                /"retweet_count":(\d+)/gi,
                /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*[Rr]etweets?/gi,
                /retweets?['"]\s*:\s*[\s]*['"]?(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/gi
            ];

            for (const pattern of retweetPatterns) {
                const matches = [...html.matchAll(pattern)];
                if (matches.length > 0) {
                    const retweetStr = matches[0][1];
                    metrics.retweets = this.parseNumberString(retweetStr);
                    if (metrics.retweets > 0) break;
                }
            }

        } catch (error) {
            logger.debug('Error parsing HTML metrics:', error.message);
        }

        return metrics.views > 0 || metrics.likes > 0 || metrics.retweets > 0 ? metrics : null;
    }

    parseEmbedMetrics(html) {
        // Simplified embed parsing
        const metrics = {
            views: 0,
            likes: 0,
            retweets: 0,
            replies: 0
        };

        // Embed HTML is usually simpler, look for basic patterns
        try {
            const patterns = {
                likes: /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*likes?/i,
                retweets: /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*retweets?/i,
                views: /(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)\s*views?/i
            };

            for (const [key, pattern] of Object.entries(patterns)) {
                const match = html.match(pattern);
                if (match) {
                    metrics[key] = this.parseNumberString(match[1]);
                }
            }
        } catch (error) {
            logger.debug('Error parsing embed metrics:', error.message);
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

    isRateLimited() {
        return Date.now() < this.rateLimitedUntil;
    }

    // Simple rate limiting
    handleRateLimit(error) {
        if (error.response?.status === 429 || error.message.includes('rate limit')) {
            this.rateLimitedUntil = Date.now() + (5 * 60 * 1000); // 5 minutes
            logger.warn('Rate limited for 5 minutes');
        }
    }

    getStatus() {
        return {
            rateLimitedUntil: this.rateLimitedUntil,
            isRateLimited: this.isRateLimited(),
            requestCount: this.requestCount,
            method: 'web-scraping'
        };
    }
}

module.exports = TwitterValidator;