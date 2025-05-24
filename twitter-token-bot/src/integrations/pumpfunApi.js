// src/integrations/pumpfunApi.js
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

            try {
                const data = JSON.parse(bodyText);
                return data;
            } catch (parseError) {
                logger.error(`JSON parsing error for URL: ${url}`);
                logger.debug(`Response body: ${bodyText.substring(0, 200)}...`);
                throw new Error(`JSON parsing failed: ${parseError.message}`);
            }

        } catch (error) {
            logger.error(`Error fetching data from ${url}:`, error.message);
            
            // Retry logic
            if (retryCount < this.maxRetries) {
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
            
            if (!Array.isArray(data)) {
                logger.warn(`Unexpected response format for trades: ${typeof data}`);
                return [];
            }

            logger.debug(`Fetched ${data.length} trades for token ${tokenAddress}`);
            return data;

        } catch (error) {
            logger.error(`Failed to fetch trades for token ${tokenAddress}:`, error);
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
            throw error;
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