// scripts/viewJsonLogs.js - Script to view and manage JSON scan logs
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

class JsonLogViewer {
    constructor() {
        this.logsDirectory = path.join(process.cwd(), 'scan_results');
    }

    async showStats() {
        console.log('📊 JSON Scan Logs Statistics');
        console.log('============================\n');

        try {
            const files = await fs.readdir(this.logsDirectory);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            if (jsonFiles.length === 0) {
                console.log('❌ No JSON log files found.');
                return;
            }

            let totalRecords = 0;
            const fileStats = [];

            for (const file of jsonFiles) {
                try {
                    const filepath = path.join(this.logsDirectory, file);
                    const stat = await fs.stat(filepath);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data.length : 1;
                    
                    totalRecords += records;
                    fileStats.push({
                        name: file,
                        size: (stat.size / 1024).toFixed(1) + ' KB',
                        records,
                        modified: stat.mtime.toLocaleDateString()
                    });
                } catch (error) {
                    console.log(`⚠️ Could not read ${file}: ${error.message}`);
                }
            }

            // Display stats
            console.log(`📁 Total Files: ${jsonFiles.length}`);
            console.log(`📊 Total Records: ${totalRecords}`);
            console.log(`🆕 Creation Files: ${jsonFiles.filter(f => f.includes('creation')).length}`);
            console.log(`🔄 Migration Files: ${jsonFiles.filter(f => f.includes('migration')).length}\n`);

            console.log('📋 File Details:');
            console.log('─'.repeat(80));
            console.log('File Name'.padEnd(35) + 'Records'.padEnd(10) + 'Size'.padEnd(10) + 'Modified');
            console.log('─'.repeat(80));

            fileStats.forEach(file => {
                console.log(
                    file.name.padEnd(35) + 
                    file.records.toString().padEnd(10) + 
                    file.size.padEnd(10) + 
                    file.modified
                );
            });

        } catch (error) {
            console.error('❌ Error reading logs directory:', error.message);
        }
    }

    async showRecent(eventType = 'both', limit = 10) {
        console.log(`📄 Recent ${eventType.toUpperCase()} Scans (Last ${limit})`);
        console.log('='.repeat(50) + '\n');

        try {
            const files = await fs.readdir(this.logsDirectory);
            let targetFiles = files.filter(file => file.endsWith('.json'));

            if (eventType !== 'both') {
                targetFiles = targetFiles.filter(file => file.includes(eventType));
            }

            const allRecords = [];

            for (const file of targetFiles) {
                try {
                    const filepath = path.join(this.logsDirectory, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data : [data];
                    
                    records.forEach(record => {
                        record._sourceFile = file;
                    });
                    
                    allRecords.push(...records);
                } catch (error) {
                    console.log(`⚠️ Could not read ${file}: ${error.message}`);
                }
            }

            // Sort by timestamp (newest first)
            allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Take latest records
            const recentRecords = allRecords.slice(0, limit);

            if (recentRecords.length === 0) {
                console.log('❌ No records found.');
                return;
            }

            recentRecords.forEach((record, index) => {
                console.log(`${index + 1}. ${this.formatRecordSummary(record)}\n`);
            });

        } catch (error) {
            console.error('❌ Error reading recent records:', error.message);
        }
    }

    async showDetailed(tokenSymbol, eventType = 'both') {
        console.log(`🔍 Detailed Scan Results for: ${tokenSymbol.toUpperCase()}`);
        console.log('='.repeat(60) + '\n');

        try {
            const files = await fs.readdir(this.logsDirectory);
            let targetFiles = files.filter(file => file.endsWith('.json'));

            if (eventType !== 'both') {
                targetFiles = targetFiles.filter(file => file.includes(eventType));
            }

            const matchingRecords = [];

            for (const file of targetFiles) {
                try {
                    const filepath = path.join(this.logsDirectory, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data : [data];
                    
                    const matches = records.filter(record => 
                        record.token?.symbol?.toLowerCase() === tokenSymbol.toLowerCase()
                    );
                    
                    matchingRecords.push(...matches);
                } catch (error) {
                    console.log(`⚠️ Could not read ${file}: ${error.message}`);
                }
            }

            if (matchingRecords.length === 0) {
                console.log(`❌ No records found for token: ${tokenSymbol}`);
                return;
            }

            // Sort by timestamp (newest first)
            matchingRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            matchingRecords.forEach((record, index) => {
                console.log(`📊 Scan #${index + 1}`);
                console.log('─'.repeat(40));
                console.log(this.formatDetailedRecord(record));
                console.log('');
            });

        } catch (error) {
            console.error('❌ Error searching for token:', error.message);
        }
    }

    formatRecordSummary(record) {
        const eventEmoji = record.eventType === 'migration' ? '🔄' : '🆕';
        const timestamp = new Date(record.timestamp).toLocaleString();
        const duration = record.scanDuration ? `${Math.round(record.scanDuration / 1000)}s` : 'N/A';
        
        let summary = `${eventEmoji} ${record.token?.symbol || 'Unknown'} | ${timestamp}`;
        
        if (record.twitter?.views > 0 || record.twitter?.likes > 0) {
            const metrics = [];
            if (record.twitter.views > 0) metrics.push(`👀 ${this.formatNumber(record.twitter.views)}`);
            if (record.twitter.likes > 0) metrics.push(`❤️ ${this.formatNumber(record.twitter.likes)}`);
            summary += `\n   Twitter: ${metrics.join(' • ')}`;
        }
        
        if (record.analysis?.bundle?.detected) {
            summary += `\n   🚨 Bundle: ${record.analysis.bundle.percentageBundled?.toFixed(1)}%`;
        }
        
        if (record.analysis?.topHolders?.analyzed) {
            const th = record.analysis.topHolders;
            summary += `\n   👥 Holders: ${th.whaleCount}🐋 ${th.freshWalletCount}🆕`;
        }
        
        summary += `\n   Duration: ${duration} | ${record.analysis?.riskLevel || 'UNKNOWN'} Risk`;
        
        return summary;
    }

    formatDetailedRecord(record) {
        let details = '';
        
        // Basic info
        details += `🪙 Token: ${record.token?.name || 'Unknown'} (${record.token?.symbol || 'Unknown'})\n`;
        details += `📍 Address: ${record.token?.address || 'N/A'}\n`;
        details += `📅 Scanned: ${new Date(record.timestamp).toLocaleString()}\n`;
        details += `⏱️ Duration: ${record.scanDuration ? Math.round(record.scanDuration / 1000) + 's' : 'N/A'}\n`;
        details += `🎯 Event: ${record.eventType?.toUpperCase() || 'UNKNOWN'}\n\n`;
        
        // Twitter metrics
        if (record.twitter) {
            details += `🐦 Twitter Metrics:\n`;
            details += `   Views: ${this.formatNumber(record.twitter.views || 0)}\n`;
            details += `   Likes: ${this.formatNumber(record.twitter.likes || 0)}\n`;
            if (record.twitter.timeAgo) {
                details += `   Posted: ${record.twitter.timeAgo}\n`;
            }
            details += '\n';
        }
        
        // Analysis results
        if (record.analysis) {
            details += `🔬 Analysis Results:\n`;
            details += `   Success: ${record.analysis.success ? '✅' : '❌'}\n`;
            details += `   Risk Level: ${record.analysis.riskLevel || 'UNKNOWN'}\n`;
            details += `   Score: ${record.analysis.overallScore || 0}/100\n\n`;
            
            // Bundle analysis
            if (record.analysis.bundle?.analyzed) {
                const bundle = record.analysis.bundle;
                details += `📦 Bundle Analysis:\n`;
                details += `   Detected: ${bundle.detected ? '🚨 YES' : '✅ NO'}\n`;
                if (bundle.detected) {
                    details += `   Bundles: ${bundle.bundleCount}\n`;
                    details += `   Percentage: ${bundle.percentageBundled?.toFixed(2)}%\n`;
                    details += `   Currently Held: ${bundle.currentlyHeldPercentage?.toFixed(2)}%\n`;
                }
                details += '\n';
            }
            
            // Top holders analysis
            if (record.analysis.topHolders?.analyzed) {
                const th = record.analysis.topHolders;
                details += `👥 Top Holders Analysis:\n`;
                details += `   Whales: ${th.whaleCount}/20 (${th.whalePercentage}%)\n`;
                details += `   Fresh Wallets: ${th.freshWalletCount}/20 (${th.freshWalletPercentage}%)\n`;
                details += `   Top 10 Holdings: ${th.concentration?.top10}%\n`;
                details += `   Risk Score: ${th.riskScore}/100\n`;
                details += '\n';
            }
            
            // Flags
            if (record.analysis.flags?.length > 0) {
                details += `🚩 Flags:\n`;
                record.analysis.flags.forEach(flag => {
                    details += `   ${flag}\n`;
                });
                details += '\n';
            }
        }
        
        // Links
        details += `🔗 Links:\n`;
        details += `   DexScreener: ${record.links?.dexscreener || 'N/A'}\n`;
        details += `   Pump.fun: ${record.links?.pumpfun || 'N/A'}\n`;
        details += `   Tweet: ${record.links?.tweet || 'N/A'}\n`;
        
        return details;
    }

    formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    async exportToCsv(eventType, outputFile) {
        console.log(`📤 Exporting ${eventType} data to CSV...`);

        try {
            const files = await fs.readdir(this.logsDirectory);
            const targetFiles = files.filter(file => 
                file.endsWith('.json') && file.includes(eventType)
            );

            const allRecords = [];

            for (const file of targetFiles) {
                try {
                    const filepath = path.join(this.logsDirectory, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data : [data];
                    allRecords.push(...records);
                } catch (error) {
                    console.log(`⚠️ Could not read ${file}: ${error.message}`);
                }
            }

            if (allRecords.length === 0) {
                console.log('❌ No records found to export.');
                return;
            }

            // Create CSV headers
            const headers = [
                'Timestamp', 'Symbol', 'Name', 'Address', 'Event Type',
                'Twitter Views', 'Twitter Likes', 'Published At',
                'Bundle Detected', 'Bundle Percentage', 'Bundle Count',
                'Whale Count', 'Fresh Wallet Count', 'Top10 Concentration',
                'Risk Level', 'Overall Score', 'Scan Duration'
            ];

            // Create CSV rows
            const rows = allRecords.map(record => [
                record.timestamp,
                record.token?.symbol || '',
                record.token?.name || '',
                record.token?.address || '',
                record.eventType || '',
                record.twitter?.views || 0,
                record.twitter?.likes || 0,
                record.twitter?.publishedAt || '',
                record.analysis?.bundle?.detected || false,
                record.analysis?.bundle?.percentageBundled || 0,
                record.analysis?.bundle?.bundleCount || 0,
                record.analysis?.topHolders?.whaleCount || 0,
                record.analysis?.topHolders?.freshWalletCount || 0,
                record.analysis?.topHolders?.concentration?.top10 || 0,
                record.analysis?.riskLevel || '',
                record.analysis?.overallScore || 0,
                record.scanDuration || 0
            ]);

            // Combine headers and rows
            const csvContent = [headers, ...rows]
                .map(row => row.map(field => `"${field}"`).join(','))
                .join('\n');

            // Write to file
            await fs.writeFile(outputFile, csvContent, 'utf8');
            console.log(`✅ Exported ${allRecords.length} records to ${outputFile}`);

        } catch (error) {
            console.error('❌ Error exporting to CSV:', error.message);
        }
    }
}

// Main execution
async function main() {
    const viewer = new JsonLogViewer();
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'stats':
            await viewer.showStats();
            break;

        case 'recent':
            const eventType = args[1] || 'both'; // creation, migration, or both
            const limit = parseInt(args[2]) || 10;
            await viewer.showRecent(eventType, limit);
            break;

        case 'search':
            const tokenSymbol = args[1];
            const searchEventType = args[2] || 'both';
            if (!tokenSymbol) {
                console.log('❌ Please provide a token symbol to search for.');
                console.log('Usage: node viewJsonLogs.js search SYMBOL [creation|migration|both]');
                break;
            }
            await viewer.showDetailed(tokenSymbol, searchEventType);
            break;

        case 'export':
            const exportEventType = args[1]; // creation or migration
            const outputFile = args[2] || `${exportEventType}_scans.csv`;
            if (!exportEventType || !['creation', 'migration'].includes(exportEventType)) {
                console.log('❌ Please specify event type: creation or migration');
                console.log('Usage: node viewJsonLogs.js export [creation|migration] [output.csv]');
                break;
            }
            await viewer.exportToCsv(exportEventType, outputFile);
            break;

        default:
            console.log('📊 JSON Scan Logs Viewer');
            console.log('========================\n');
            console.log('Available commands:');
            console.log('  stats                              - Show file statistics');
            console.log('  recent [type] [limit]             - Show recent scans (default: both, 10)');
            console.log('  search SYMBOL [type]              - Search for specific token');
            console.log('  export [creation|migration] [file] - Export to CSV');
            console.log('\nExamples:');
            console.log('  node viewJsonLogs.js stats');
            console.log('  node viewJsonLogs.js recent creation 5');
            console.log('  node viewJsonLogs.js search PEPECOIN');
            console.log('  node viewJsonLogs.js export creation creation_scans.csv');
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
}

module.exports = JsonLogViewer;