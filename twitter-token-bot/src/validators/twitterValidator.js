// Simplified TwitterValidator with URL extraction and validation
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class TwitterValidator {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 15000,
            quickTimeout: config.quickTimeout || 5000,
            enablePageExtraction: config.enablePageExtraction !== false,
            ...config
        };

        this.browser = null;
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
    }

    /**
     * NEW METHOD: Extract Twitter status URL from token event
     */
    async extractTwitterUrl(tokenEvent) {
        // Check direct fields first
        const possibleFields = ['twitter', 'social', 'socials'];
        
        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                const statusUrl = this.findTwitterStatusUrl(tokenEvent[field]);
                if (statusUrl) return statusUrl;
            }
        }

        // Check metadata URI
        if (tokenEvent.uri) {
            return await this.extractFromMetadataUri(tokenEvent.uri);
        }

        return null;
    }

    /**
     * Find valid Twitter status URLs (not profiles)
     */
    findTwitterStatusUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];

        for (const pattern of statusPatterns) {
            const matches = text.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    /**
     * Extract Twitter URL from metadata URI
     */
    async extractFromMetadataUri(uri) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const response = await axios.get(fetchUrl, { 
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)' }
            });
            
            if (response.data) {
                return this.findTwitterStatusInMetadata(response.data);
            }
            return null;
            
        } catch (error) {
            logger.debug(`Failed to fetch metadata from ${uri}: ${error.message}`);
            return null;
        }
    }

    /**
     * Find Twitter status URLs in metadata (strict - status only)
     */
    findTwitterStatusInMetadata(metadata) {
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];
        
        const fieldsToCheck = ['twitter', 'social', 'socials', 'links', 'external_url', 'description'];
        
        // Check specific fields first
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of statusPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) return matches[0];
                }
            }
        }
        
        // Check entire metadata as fallback
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of statusPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    /**
     * Quick likes check (fast validation)
     */
    async quickLikesCheck(twitterUrl) {
        if (!twitterUrl) return null;

        const tweetId = this.extractTweetId(twitterUrl);
        if (!tweetId) return null;

        try {
            const metrics = await this.getQuickMetrics(tweetId);
            
            if (metrics && metrics.likes > 0) {
                return {
                    link: twitterUrl,
                    likes: metrics.likes,
                    publishedAt: metrics.publishedAt,
                    views: 0,
                    retweets: 0,
                    replies: 0
                };
            }
            return null;

        } catch (error) {
            logger.debug(`Quick likes check failed for ${tweetId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Full validation with views (slower)
     */
    async validateEngagement(twitterUrl) {
        if (!twitterUrl) return null;

        const tweetId = this.extractTweetId(twitterUrl);
        if (!tweetId) return null;

        try {
            // Try API first
            const apiMetrics = await this.getFullMetrics(tweetId);
            
            // If no views and page extraction enabled, try puppeteer
            if (this.config.enablePageExtraction && (!apiMetrics || apiMetrics.views === 0)) {
                const pageMetrics = await this.getViewsFromPage(tweetId);
                if (pageMetrics) {
                    return {
                        link: twitterUrl,
                        views: pageMetrics.views || 0,
                        likes: Math.max(pageMetrics.likes || 0, apiMetrics?.likes || 0),
                        retweets: 0,
                        replies: 0,
                        publishedAt: pageMetrics.publishedAt || apiMetrics?.publishedAt
                    };
                }
            }

            // Return API metrics or defaults
            return {
                link: twitterUrl,
                views: apiMetrics?.views || 0,
                likes: apiMetrics?.likes || 0,
                retweets: 0,
                replies: 0,
                publishedAt: apiMetrics?.publishedAt
            };

        } catch (error) {
            logger.debug(`Validation failed for ${tweetId}: ${error.message}`);
            return {
                link: twitterUrl,
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0,
                publishedAt: null
            };
        }
    }

    /**
     * Quick metrics from syndication API
     */
    async getQuickMetrics(tweetId) {
        const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
        
        const response = await this.httpClient.get(url, {
            timeout: this.config.quickTimeout,
            headers: {
                'Referer': 'https://platform.twitter.com/',
                'Origin': 'https://platform.twitter.com'
            }
        });

        if (response.data) {
            return {
                likes: parseInt(response.data.favorite_count || response.data.favoriteCount || response.data.like_count) || 0,
                publishedAt: this.parseTwitterDate(response.data.created_at || response.data.created_time)
            };
        }
        return null;
    }

    /**
     * Full metrics from syndication API
     */
    async getFullMetrics(tweetId) {
        const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
        
        const response = await this.httpClient.get(url, {
            headers: {
                'Referer': 'https://platform.twitter.com/',
                'Origin': 'https://platform.twitter.com'
            }
        });

        if (response.data) {
            return {
                views: parseInt(response.data.view_count || response.data.viewCount) || 0,
                likes: parseInt(response.data.favorite_count || response.data.favoriteCount || response.data.like_count) || 0,
                publishedAt: this.parseTwitterDate(response.data.created_at || response.data.created_time)
            };
        }
        return null;
    }

    /**
     * Get views from page scraping
     */
    async getViewsFromPage(tweetId) {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        }

        const page = await this.browser.newPage();
        
        try {
            await page.goto(`https://twitter.com/i/status/${tweetId}`, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            await page.waitForTimeout(3000);
            const content = await page.content();
            
            return this.parseMetricsFromHtml(content);

        } catch (error) {
            logger.debug(`Page scraping failed for ${tweetId}: ${error.message}`);
            return null;
        } finally {
            await page.close();
        }
    }

    /**
     * Parse metrics from HTML
     */
    parseMetricsFromHtml(html) {
        const metrics = { views: 0, likes: 0, publishedAt: null };

        // Extract views
        const viewPatterns = [
            /"viewCount":"(\d+)"/g,
            /(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:Views?|views?)/gi
        ];

        for (const pattern of viewPatterns) {
            const matches = [...html.matchAll(pattern)];
            for (const match of matches) {
                if (match[1]) {
                    const viewCount = this.parseNumber(match[1]);
                    if (viewCount > metrics.views) metrics.views = viewCount;
                }
            }
        }

        // Extract likes
        const likePatterns = [
            /"favorite_count":"(\d+)"/g,
            /(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:Likes?|likes?)/gi
        ];

        for (const pattern of likePatterns) {
            const matches = [...html.matchAll(pattern)];
            for (const match of matches) {
                if (match[1]) {
                    const likeCount = this.parseNumber(match[1]);
                    if (likeCount > metrics.likes) metrics.likes = likeCount;
                }
            }
        }

        return metrics;
    }

    /**
     * Parse numbers with K/M/B suffixes
     */
    parseNumber(str) {
        if (!str) return 0;
        
        const clean = str.replace(/,/g, '').trim();
        
        if (clean.includes('K') || clean.includes('k')) {
            return Math.round(parseFloat(clean) * 1000);
        } else if (clean.includes('M') || clean.includes('m')) {
            return Math.round(parseFloat(clean) * 1000000);
        } else if (clean.includes('B') || clean.includes('b')) {
            return Math.round(parseFloat(clean) * 1000000000);
        }
        
        return parseInt(clean) || 0;
    }

    /**
     * Extract tweet ID from URL
     */
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

    /**
     * Parse Twitter date
     */
    parseTwitterDate(dateString) {
        if (!dateString) return null;
        
        try {
            const date = typeof dateString === 'number' ? 
                new Date(dateString * 1000) : new Date(dateString);
            
            return isNaN(date.getTime()) ? null : date.toISOString();
        } catch (error) {
            return null;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = TwitterValidator;