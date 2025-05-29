// src/integrations/pumpfunApi.js - FIXED to handle empty arrays properly
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api-v3.pump.fun';
        this.browser = null;
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    async initializeBrowser() {
        if (!this.browser) {
            try {
                this.browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-plugins'
                    ],
                });
                logger.debug('PumpFun browser initialized');
            } catch (error) {
                logger.error('Failed to initialize browser:', error);
                throw error;
            }
        }
    }

    async configurePage(page) {
        try {
            const userAgent = new UserAgent();
            await page.setUserAgent(userAgent.toString());
            
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun',
            });

            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        } catch (error) {
            logger.error('Failed to configure page:', error);
            throw error;
        }
    }

    async fetchData(url, retryCount = 0) {
        await this.initializeBrowser();
        let page = null;

        try {
            page = await this.browser.newPage();
            await this.configurePage(page);
            
            logger.debug(`Fetching data from: ${url}`);
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            const bodyText = await page.evaluate(() => document.body.innerText);

            // FIXED: Handle empty responses properly
            if (!bodyText || bodyText.trim() === '') {
                logger.debug(`Empty response body from ${url}`);
                return []; // Return empty array for empty responses
            }

            // FIXED: Handle whitespace and minimal responses
            const trimmedBody = bodyText.trim();
            
            // Check if it's just an empty array
            if (trimmedBody === '[]') {
                logger.debug(`Empty array response from ${url}`);
                return [];
            }

            try {
                const data = JSON.parse(trimmedBody);
                logger.debug(`Successfully parsed JSON from ${url}: ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
                return data;
            } catch (parseError) {
                logger.error(`JSON parsing error for URL: ${url}`);
                logger.debug(`Response body (first 500 chars): ${trimmedBody.substring(0, 500)}`);
                
                // FIXED: Don't retry on empty arrays or small responses that might be valid
                if (trimmedBody.length <= 10) {
                    logger.debug(`Very short response (${trimmedBody.length} chars), treating as empty: "${trimmedBody}"`);
                    return [];
                }
                
                throw new Error(`JSON parsing failed: ${parseError.message}`);
            }

        } catch (error) {
            logger.error(`Error fetching data from ${url}:`, error.message);
            
            // FIXED: Don't retry on parsing errors for short responses
            if (error.message.includes('JSON parsing failed') && retryCount < this.maxRetries) {
                logger.info(`Retrying request (${retryCount + 1}/${this.maxRetries}) after ${this.retryDelay}ms`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
                return this.fetchData(url, retryCount + 1);
            }
            
            throw error;
        } finally {
            if (page) {
                await page.close();
            }
        }
    }

    async getAllTrades(tokenAddress, limit = 200, offset = 0, minimumSize = 0) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/trades/all/${tokenAddress}?limit=${limit}&offset=${offset}&minimumSize=${minimumSize}`;
        
        try {
            const data = await this.fetchData(url);
            
            // Ensure we always return an array
            if (!Array.isArray(data)) {
                logger.warn(`Unexpected response format for trades: ${typeof data}`);
                return [];
            }

            logger.debug(`Fetched ${data.length} trades for token ${tokenAddress} (offset: ${offset})`);
            return data;

        } catch (error) {
            logger.error(`Failed to fetch trades for token ${tokenAddress}:`, error);
            
            // FIXED: Return empty array instead of throwing for recoverable errors
            if (error.message.includes('JSON parsing failed') || 
                error.message.includes('Empty response') ||
                error.message.includes('timeout')) {
                logger.warn(`Returning empty array due to API error: ${error.message}`);
                return [];
            }
            
            throw error;
        }
    }

    async getTokenInfo(tokenAddress) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/coins/${tokenAddress}`;
        
        try {
            const data = await this.fetchData(url);
            return data;
        } catch (error) {
            logger.error(`Failed to fetch token info for ${tokenAddress}:`, error);
            throw error;
        }
    }

    async getUserTrades(userAddress, limit = 50, offset = 0) {
        if (!userAddress) {
            throw new Error("User address is required");
        }

        const url = `${this.baseUrl}/trades/user/${userAddress}?limit=${limit}&offset=${offset}`;
        
        try {
            const data = await this.fetchData(url);
            return Array.isArray(data) ? data : [];
        } catch (error) {
            logger.error(`Failed to fetch user trades for ${userAddress}:`, error);
            return [];
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
                logger.debug('PumpFun browser closed');
            } catch (error) {
                logger.error('Error closing browser:', error);
            }
        }
    }

    // Cleanup method for graceful shutdown
    async cleanup() {
        await this.closeBrowser();
    }
}

// Export singleton instance
module.exports = new PumpFunApi();