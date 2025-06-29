// src/validators/twitterValidator.js - Clean Twitter-only validator
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
            timeout: config.timeout || 30000,
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
     * Quick likes check using Twitter syndication API
     * @param {string} twitterUrl - Twitter status URL
     * @returns {Object|null} - Engagement metrics or null
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
                        platform: 'twitter',
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
     * @param {string} twitterUrl - Twitter status URL
     * @returns {Object|null} - Full engagement metrics or null
     */
    async validateEngagement(twitterUrl) {
        if (!twitterUrl) return null;

        const tweetId = this.extractTweetId(twitterUrl);
        if (!tweetId) return null;

        try {
            // Get likes first (this already works)
            const quickMetrics = await this.quickLikesCheck(twitterUrl);
            
            // Get views if enabled
            if (this.config.enablePageExtraction) {
                const pageMetrics = await this.getViewsFromPage(tweetId);
                if (pageMetrics && pageMetrics.views > 0) {
                    // Combine: views from page + likes from quickMetrics
                    return {
                        link: twitterUrl,
                        platform: 'twitter',
                        views: pageMetrics.views,
                        likes: quickMetrics?.likes || 0,
                        retweets: 0,
                        replies: 0,
                        publishedAt: quickMetrics?.publishedAt || null
                    };
                }
            }

            // Fallback to just likes
            return quickMetrics || {
                link: twitterUrl,
                platform: 'twitter',
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0,
                publishedAt: null
            };

        } catch (error) {
            logger.debug(`Twitter validation failed for ${tweetId}: ${error.message}`);
            return {
                link: twitterUrl,
                platform: 'twitter',
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0,
                publishedAt: null
            };
        }
    }

    /**
     * Get views from page using puppeteer
     * @param {string} tweetId - Tweet ID
     * @returns {Object|null} - Views data or null
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
                timeout: this.config.timeout 
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            // Find the exact span that contains "Views"
            const views = await page.evaluate(() => {
                const spans = document.querySelectorAll('span.css-1jxf684.r-bcqeeo.r-1ttztb7.r-qvutc0.r-poiln3');
                
                for (const span of spans) {
                    const text = span.textContent.trim();
                    if (text.includes('Views')) {
                        return text;
                    }
                }
                
                return null;
            });

            if (!views) {
                return null;
            }

            // Parse the views number
            const viewCount = this.parseNumber(views);
            
            return { views: viewCount, likes: 0 };

        } catch (error) {
            logger.debug(`Page scraping failed for ${tweetId}: ${error.message}`);
            return null;
        } finally {
            await page.close();
        }
    }

    /**
     * Parse number from text like "6,146 Views"
     * @param {string} str - Text containing number
     * @returns {number} - Parsed number
     */
    parseNumber(str) {
        if (!str || typeof str !== 'string') return 0;
        
        // Remove everything except digits and commas
        const number = str.replace(/[^\d,]/g, '');
        
        // Remove commas and parse
        return parseInt(number.replace(/,/g, '')) || 0;
    }

    /**
     * Extract tweet ID from Twitter URL
     * @param {string} url - Twitter URL
     * @returns {string|null} - Tweet ID or null
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
     * Parse Twitter date string
     * @param {string|number} dateString - Date from Twitter API
     * @returns {string|null} - ISO date string or null
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

    /**
     * Validate if URL is a Twitter status URL
     * @param {string} url - URL to validate
     * @returns {boolean} - Is valid Twitter URL
     */
    isValidTwitterUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const patterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/i,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/i
        ];

        return patterns.some(pattern => pattern.test(url));
    }

    /**
     * Get configuration
     * @returns {Object} - Current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Clean up resources
     */
    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = TwitterValidator;