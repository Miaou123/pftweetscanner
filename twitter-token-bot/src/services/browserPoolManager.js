// src/services/browserPoolManager.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class BrowserPoolManager {
    constructor(config = {}) {
        this.config = {
            poolSize: config.poolSize || 2, // 2-3 browsers as suggested
            maxPageAge: config.maxPageAge || 10 * 60 * 1000, // 10 minutes before refresh
            maxBrowserAge: config.maxBrowserAge || 30 * 60 * 1000, // 30 minutes before restart
            pageTimeout: config.pageTimeout || 15000,
            ...config
        };

        this.browsers = [];
        this.availablePages = [];
        this.busyPages = new Set();
        this.isInitialized = false;
        
        // Track usage for maintenance
        this.pageUsageCount = new Map();
        this.pageCreatedAt = new Map();
        this.browserCreatedAt = new Map();

        logger.info(`🌐 Browser Pool Manager initialized: ${this.config.poolSize} browsers, ${this.config.maxPageAge / 1000}s page refresh`);
    }

    async initialize() {
        if (this.isInitialized) return;

        logger.info(`🚀 Initializing browser pool with ${this.config.poolSize} browsers...`);

        try {
            // Create browsers
            for (let i = 0; i < this.config.poolSize; i++) {
                const browser = await this.createBrowser(i);
                this.browsers.push(browser);
                
                // Create initial page for each browser
                const page = await this.createPage(browser);
                this.availablePages.push(page);
                
                logger.debug(`✅ Browser ${i + 1}/${this.config.poolSize} ready`);
            }

            this.isInitialized = true;
            logger.info(`✅ Browser pool initialized with ${this.browsers.length} browsers and ${this.availablePages.length} pages`);

            // Start maintenance routine
            this.startMaintenance();

        } catch (error) {
            logger.error('❌ Failed to initialize browser pool:', error);
            await this.cleanup();
            throw error;
        }
    }

    async createBrowser(index) {
        const browser = await puppeteer.launch({
            headless: 'new', // Use new headless mode to avoid deprecation warning
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
                '--disable-plugins',
                '--disable-images', // Speed up page loads
                '--disable-javascript', // We only need HTML content
            ],
        });

        this.browserCreatedAt.set(browser, Date.now());
        
        // Handle browser disconnection
        browser.on('disconnected', () => {
            logger.warn(`🔌 Browser ${index} disconnected, will recreate if needed`);
            this.handleBrowserDisconnection(browser);
        });

        return browser;
    }

    async createPage(browser) {
        const page = await browser.newPage();
        
        // Configure page for Twitter scraping
        const userAgent = new UserAgent();
        await page.setUserAgent(userAgent.toString());
        
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://twitter.com/',
            'Origin': 'https://twitter.com',
        });

        // Block unnecessary resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'script'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Track page creation time and usage
        this.pageCreatedAt.set(page, Date.now());
        this.pageUsageCount.set(page, 0);

        return page;
    }

    async getPage() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Wait for available page with timeout
        const maxWaitTime = 10000; // 10 seconds
        const startTime = Date.now();

        while (this.availablePages.length === 0) {
            if (Date.now() - startTime > maxWaitTime) {
                throw new Error('Timeout waiting for available page in browser pool');
            }
            
            logger.debug('⏳ Waiting for available page...');
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const page = this.availablePages.pop();
        this.busyPages.add(page);

        // Increment usage count
        const currentUsage = this.pageUsageCount.get(page) || 0;
        this.pageUsageCount.set(page, currentUsage + 1);

        logger.debug(`📄 Page acquired (${this.busyPages.size} busy, ${this.availablePages.length} available)`);
        
        return page;
    }

    async releasePage(page) {
        if (!page || !this.busyPages.has(page)) {
            logger.warn('⚠️ Attempted to release page that was not tracked as busy');
            return;
        }

        this.busyPages.delete(page);

        // Check if page needs refresh
        const pageAge = Date.now() - (this.pageCreatedAt.get(page) || 0);
        const usageCount = this.pageUsageCount.get(page) || 0;

        if (pageAge > this.config.maxPageAge || usageCount > 50) {
            logger.debug(`🔄 Refreshing page (age: ${Math.round(pageAge / 1000)}s, usage: ${usageCount})`);
            await this.refreshPage(page);
        } else {
            // Just clear the page and reuse
            try {
                await page.goto('about:blank');
                await page.evaluate(() => {
                    // Clear any cached data
                    if (typeof localStorage !== 'undefined') {
                        localStorage.clear();
                    }
                    if (typeof sessionStorage !== 'undefined') {
                        sessionStorage.clear();
                    }
                });
            } catch (error) {
                logger.debug('Error clearing page, will refresh:', error.message);
                await this.refreshPage(page);
                return;
            }
        }

        this.availablePages.push(page);
        logger.debug(`📄 Page released (${this.busyPages.size} busy, ${this.availablePages.length} available)`);
    }

    async refreshPage(page) {
        try {
            const browser = page.browser();
            
            // Close old page
            await page.close();
            
            // Remove from tracking
            this.pageCreatedAt.delete(page);
            this.pageUsageCount.delete(page);
            
            // Create new page
            const newPage = await this.createPage(browser);
            return newPage;
            
        } catch (error) {
            logger.error('Error refreshing page:', error);
            // If refresh fails, we'll let the maintenance routine handle it
            throw error;
        }
    }

    async handleBrowserDisconnection(disconnectedBrowser) {
        // Remove disconnected browser from pool
        const index = this.browsers.indexOf(disconnectedBrowser);
        if (index > -1) {
            this.browsers.splice(index, 1);
        }

        // Remove any pages from the disconnected browser
        this.availablePages = this.availablePages.filter(page => {
            if (page.browser() === disconnectedBrowser) {
                this.pageCreatedAt.delete(page);
                this.pageUsageCount.delete(page);
                return false;
            }
            return true;
        });

        // Remove from busy pages
        for (const page of this.busyPages) {
            if (page.browser() === disconnectedBrowser) {
                this.busyPages.delete(page);
                this.pageCreatedAt.delete(page);
                this.pageUsageCount.delete(page);
            }
        }

        // Create replacement browser if we're below target
        if (this.browsers.length < this.config.poolSize) {
            try {
                logger.info('🔄 Creating replacement browser...');
                const newBrowser = await this.createBrowser(this.browsers.length);
                this.browsers.push(newBrowser);
                
                const newPage = await this.createPage(newBrowser);
                this.availablePages.push(newPage);
                
                logger.info('✅ Replacement browser created');
            } catch (error) {
                logger.error('❌ Failed to create replacement browser:', error);
            }
        }
    }

    startMaintenance() {
        // Run maintenance every 5 minutes
        setInterval(() => {
            this.runMaintenance();
        }, 5 * 60 * 1000);

        logger.debug('🔧 Browser pool maintenance started');
    }

    async runMaintenance() {
        logger.debug('🔧 Running browser pool maintenance...');

        try {
            // Check for old browsers that need restart
            for (const browser of this.browsers) {
                const browserAge = Date.now() - (this.browserCreatedAt.get(browser) || 0);
                
                if (browserAge > this.config.maxBrowserAge) {
                    logger.info(`🔄 Restarting browser (age: ${Math.round(browserAge / 1000 / 60)}min)`);
                    await this.restartBrowser(browser);
                }
            }

            // Check pool health
            const totalPages = this.availablePages.length + this.busyPages.size;
            if (totalPages < this.config.poolSize) {
                logger.warn(`⚠️ Page pool below target (${totalPages}/${this.config.poolSize}), creating pages...`);
                await this.ensureMinimumPages();
            }

            // Log status
            const stats = this.getStats();
            logger.debug(`📊 Pool stats: ${stats.totalBrowsers} browsers, ${stats.totalPages} pages (${stats.availablePages} available, ${stats.busyPages} busy)`);

        } catch (error) {
            logger.error('❌ Error during maintenance:', error);
        }
    }

    async restartBrowser(oldBrowser) {
        try {
            // Find pages belonging to this browser
            const browserPages = this.availablePages.filter(page => page.browser() === oldBrowser);
            
            // Remove from available pages
            this.availablePages = this.availablePages.filter(page => page.browser() !== oldBrowser);
            
            // Clean up tracking
            for (const page of browserPages) {
                this.pageCreatedAt.delete(page);
                this.pageUsageCount.delete(page);
            }

            // Close old browser
            await oldBrowser.close();
            this.browserCreatedAt.delete(oldBrowser);

            // Remove from browsers array
            const index = this.browsers.indexOf(oldBrowser);
            if (index > -1) {
                this.browsers.splice(index, 1);
            }

            // Create new browser
            const newBrowser = await this.createBrowser(this.browsers.length);
            this.browsers.push(newBrowser);

            // Create new page
            const newPage = await this.createPage(newBrowser);
            this.availablePages.push(newPage);

            logger.info('✅ Browser restart completed');

        } catch (error) {
            logger.error('❌ Error restarting browser:', error);
        }
    }

    async ensureMinimumPages() {
        const targetPages = this.config.poolSize;
        const currentPages = this.availablePages.length + this.busyPages.size;
        
        if (currentPages >= targetPages) return;

        const needed = targetPages - currentPages;
        logger.info(`📄 Creating ${needed} additional pages...`);

        for (let i = 0; i < needed && i < this.browsers.length; i++) {
            try {
                const browser = this.browsers[i % this.browsers.length];
                const newPage = await this.createPage(browser);
                this.availablePages.push(newPage);
            } catch (error) {
                logger.error('❌ Error creating additional page:', error);
            }
        }
    }

    getStats() {
        return {
            totalBrowsers: this.browsers.length,
            totalPages: this.availablePages.length + this.busyPages.size,
            availablePages: this.availablePages.length,
            busyPages: this.busyPages.size,
            isInitialized: this.isInitialized,
            poolSize: this.config.poolSize
        };
    }

    async cleanup() {
        logger.info('🧹 Cleaning up browser pool...');

        try {
            // Close all browsers
            const closePromises = this.browsers.map(async (browser) => {
                try {
                    await browser.close();
                } catch (error) {
                    logger.debug('Error closing browser during cleanup:', error);
                }
            });

            await Promise.allSettled(closePromises);

            // Clear all tracking
            this.browsers = [];
            this.availablePages = [];
            this.busyPages.clear();
            this.pageUsageCount.clear();
            this.pageCreatedAt.clear();
            this.browserCreatedAt.clear();
            this.isInitialized = false;

            logger.info('✅ Browser pool cleanup completed');

        } catch (error) {
            logger.error('❌ Error during browser pool cleanup:', error);
        }
    }
}

// Export singleton instance
module.exports = new BrowserPoolManager();