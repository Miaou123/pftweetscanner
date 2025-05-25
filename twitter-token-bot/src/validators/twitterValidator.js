// Cleaned TwitterValidator - Only fast likes + puppeteer views
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class TwitterValidator {
    constructor(config = {}) {
        this.config = {
            quickTimeout: config.quickTimeout || 5000,
            enablePageExtraction: config.enablePageExtraction !== false,
            ...config
        };

        this.browser = null;
        this.httpClient = axios.create({
            timeout: this.config.quickTimeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
    }

    /**
     * Extract Twitter status URL from token event
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
     * Fast likes check using syndication API
     */
    async quickLikesCheck(twitterUrl) {
        if (!twitterUrl) return null;

        const tweetId = this.extractTweetId(twitterUrl);
        if (!tweetId) return null;

        try {
            const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
            
            const response = await this.httpClient.get(url, {
                headers: {
                    'Referer': 'https://platform.twitter.com/',
                    'Origin': 'https://platform.twitter.com'
                }
            });

            if (response.data) {
                const likes = parseInt(response.data.favorite_count || response.data.favoriteCount || response.data.like_count) || 0;
                
                if (likes > 0) {
                    return {
                        link: twitterUrl,
                        likes: likes,
                        publishedAt: this.parseTwitterDate(response.data.created_at || response.data.created_time),
                        views: 0,
                        retweets: 0,
                        replies: 0
                    };
                }
            }
            return null;

        } catch (error) {
            logger.debug(`Quick likes check failed for ${tweetId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Full validation with views using puppeteer
     */
    async validateEngagement(twitterUrl) {
        if (!twitterUrl) return null;

        const tweetId = this.extractTweetId(twitterUrl);
        if (!tweetId) return null;

        try {
            // Get views from puppeteer if enabled
            if (this.config.enablePageExtraction) {
                const pageMetrics = await this.getViewsFromPage(tweetId);
                if (pageMetrics) {
                    return {
                        link: twitterUrl,
                        views: pageMetrics.views || 0,
                        likes: pageMetrics.likes || 0,
                        retweets: 0,
                        replies: 0,
                        publishedAt: null
                    };
                }
            }

            // Fallback to just likes
            return await this.quickLikesCheck(twitterUrl) || {
                link: twitterUrl,
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0,
                publishedAt: null
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
     * Get views from page using puppeteer - targets exact CSS class
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

            // Get all spans with the exact CSS class for metrics
            const metrics = await page.evaluate(() => {
                const spans = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
                const numbers = [];
                
                spans.forEach(span => {
                    const text = span.textContent.trim();
                    if (/^\d+(\.\d+)?[KMB]?$/.test(text)) {
                        numbers.push(text);
                    }
                });
                
                return numbers;
            });

            const parsedNumbers = metrics.map(num => this.parseNumber(num)).filter(n => n > 0);
            
            if (parsedNumbers.length > 0) {
                // Views are typically the largest number
                const views = Math.max(...parsedNumbers);
                // Likes are typically smaller
                const likes = parsedNumbers.find(n => n < views && n > 0) || 0;
                
                return { views, likes };
            }

            return null;

        } catch (error) {
            logger.debug(`Page scraping failed for ${tweetId}: ${error.message}`);
            return null;
        } finally {
            await page.close();
        }
    }

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