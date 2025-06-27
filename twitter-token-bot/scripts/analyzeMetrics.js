// scripts/analyzeEnhancedMetrics.js - Analyze the new bundle and top holders metrics
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

class EnhancedMetricsAnalyzer {
    constructor() {
        this.scanResultsDir = path.join(process.cwd(), 'scan_results');
    }

    async analyzeAllMetrics() {
        console.log('📊 Enhanced Metrics Analysis with Bundle & Top Holders Data');
        console.log('='.repeat(70));

        try {
            const files = await fs.readdir(this.scanResultsDir);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            console.log(`📁 Found ${jsonFiles.length} scan result files\n`);

            const allRecords = [];
            let totalRecords = 0;

            // Load all records
            for (const file of jsonFiles) {
                try {
                    const filepath = path.join(this.scanResultsDir, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);
                    const records = Array.isArray(data) ? data : [data];
                    
                    console.log(`📄 ${file}: ${records.length} records`);
                    allRecords.push(...records);
                    totalRecords += records.length;
                } catch (error) {
                    console.log(`⚠️ Error reading ${file}: ${error.message}`);
                }
            }

            console.log(`\n📊 Total records loaded: ${totalRecords}`);

            if (totalRecords === 0) {
                console.log('❌ No records found to analyze');
                return;
            }

            // Analyze by event type
            const creationRecords = allRecords.filter(r => r.eventType === 'creation');
            const migrationRecords = allRecords.filter(r => r.eventType === 'migration');

            console.log(`\n📈 Record Distribution:`);
            console.log(`   • Creation events: ${creationRecords.length}`);
            console.log(`   • Migration events: ${migrationRecords.length}`);

            // Analyze each type
            if (creationRecords.length > 0) {
                console.log('\n' + '='.repeat(50));
                console.log('🆕 CREATION TOKEN ANALYSIS');
                console.log('='.repeat(50));
                this.analyzeRecordSet(creationRecords, 'Creation');
            }

            if (migrationRecords.length > 0) {
                console.log('\n' + '='.repeat(50));
                console.log('🔄 MIGRATION TOKEN ANALYSIS');
                console.log('='.repeat(50));
                this.analyzeRecordSet(migrationRecords, 'Migration');
            }

            // Combined analysis
            console.log('\n' + '='.repeat(50));
            console.log('🔍 COMBINED ANALYSIS');
            console.log('='.repeat(50));
            this.analyzeRecordSet(allRecords, 'All');

            // Find interesting patterns
            this.findInterestingPatterns(allRecords);

        } catch (error) {
            console.error('❌ Error analyzing metrics:', error);
        }
    }

    analyzeRecordSet(records, label) {
        console.log(`\n📊 ${label} Token Metrics (${records.length} tokens):`);

        // Basic Twitter metrics
        this.analyzeTwitterMetrics(records);

        // Bundle analysis metrics
        this.analyzeBundleMetrics(records);

        // Top holders metrics
        this.analyzeTopHoldersMetrics(records);

        // Risk distribution
        this.analyzeRiskDistribution(records);
    }

    analyzeTwitterMetrics(records) {
        const totalLikes = records.reduce((sum, r) => sum + (r.likes || 0), 0);
        const totalViews = records.reduce((sum, r) => sum + (r.views || 0), 0);
        const avgLikes = records.length > 0 ? totalLikes / records.length : 0;
        const avgViews = records.length > 0 ? totalViews / records.length : 0;

        const likesRanges = {
            '0-99': 0,
            '100-499': 0,
            '500-999': 0,
            '1000-4999': 0,
            '5000+': 0
        };

        records.forEach(r => {
            const likes = r.likes || 0;
            if (likes < 100) likesRanges['0-99']++;
            else if (likes < 500) likesRanges['100-499']++;
            else if (likes < 1000) likesRanges['500-999']++;
            else if (likes < 5000) likesRanges['1000-4999']++;
            else likesRanges['5000+']++;
        });

        console.log(`\n🐦 Twitter Metrics:`);
        console.log(`   • Average Likes: ${avgLikes.toFixed(0)}`);
        console.log(`   • Average Views: ${this.formatNumber(avgViews)}`);
        console.log(`   • Total Likes: ${totalLikes.toLocaleString()}`);
        console.log(`   • Total Views: ${this.formatNumber(totalViews)}`);
        
        console.log(`\n   📊 Likes Distribution:`);
        Object.entries(likesRanges).forEach(([range, count]) => {
            const percentage = records.length > 0 ? (count / records.length * 100).toFixed(1) : '0';
            console.log(`      ${range}: ${count} (${percentage}%)`);
        });
    }

    analyzeBundleMetrics(records) {
        const bundleRecords = records.filter(r => r.analysis?.bundleAnalysis);
        
        if (bundleRecords.length === 0) {
            console.log(`\n📦 Bundle Analysis: No bundle analysis data found`);
            return;
        }

        const bundleDetected = bundleRecords.filter(r => r.analysis.bundleAnalysis.detected);
        const detectionRate = (bundleDetected.length / bundleRecords.length) * 100;

        const avgPercentageBundled = bundleRecords.reduce((sum, r) => 
            sum + (r.analysis.bundleAnalysis.percentageBundled || 0), 0) / bundleRecords.length;

        const avgCurrentlyHeld = bundleRecords.reduce((sum, r) => 
            sum + (r.analysis.bundleAnalysis.currentlyHeldPercentage || 0), 0) / bundleRecords.length;

        // Bundle severity distribution
        const bundleSeverity = {
            'None (0%)': 0,
            'Low (0.1-10%)': 0,
            'Medium (10-30%)': 0,
            'High (30-50%)': 0,
            'Very High (50%+)': 0
        };

        bundleRecords.forEach(r => {
            const percentage = r.analysis.bundleAnalysis.percentageBundled || 0;
            if (percentage === 0) bundleSeverity['None (0%)']++;
            else if (percentage <= 10) bundleSeverity['Low (0.1-10%)']++;
            else if (percentage <= 30) bundleSeverity['Medium (10-30%)']++;
            else if (percentage <= 50) bundleSeverity['High (30-50%)']++;
            else bundleSeverity['Very High (50%+)']++;
        });

        console.log(`\n📦 Bundle Analysis (${bundleRecords.length} analyzed):`);
        console.log(`   • Detection Rate: ${detectionRate.toFixed(1)}% (${bundleDetected.length}/${bundleRecords.length})`);
        console.log(`   • Average % Bundled: ${avgPercentageBundled.toFixed(2)}%`);
        console.log(`   • Average Currently Held: ${avgCurrentlyHeld.toFixed(2)}%`);

        console.log(`\n   📊 Bundle Severity Distribution:`);
        Object.entries(bundleSeverity).forEach(([range, count]) => {
            const percentage = bundleRecords.length > 0 ? (count / bundleRecords.length * 100).toFixed(1) : '0';
            console.log(`      ${range}: ${count} (${percentage}%)`);
        });

        // Show most severe bundles
        const severeBundles = bundleRecords
            .filter(r => (r.analysis.bundleAnalysis.percentageBundled || 0) > 30)
            .sort((a, b) => (b.analysis.bundleAnalysis.percentageBundled || 0) - (a.analysis.bundleAnalysis.percentageBundled || 0))
            .slice(0, 5);

        if (severeBundles.length > 0) {
            console.log(`\n   🚨 Most Severe Bundle Cases:`);
            severeBundles.forEach((record, i) => {
                const bundle = record.analysis.bundleAnalysis;
                console.log(`      ${i + 1}. ${record.symbol}: ${bundle.percentageBundled.toFixed(1)}% bundled, ${bundle.currentlyHeldPercentage.toFixed(1)}% held`);
            });
        }
    }

    analyzeTopHoldersMetrics(records) {
        const holdersRecords = records.filter(r => r.analysis?.topHoldersAnalysis?.analyzed);
        
        if (holdersRecords.length === 0) {
            console.log(`\n👥 Top Holders Analysis: No top holders analysis data found`);
            return;
        }

        // ⭐ KEY METRICS YOU REQUESTED
        const avgTop10Holdings = holdersRecords.reduce((sum, r) => 
            sum + (r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0), 0) / holdersRecords.length;

        const avgTop5Holdings = holdersRecords.reduce((sum, r) => 
            sum + (r.analysis.topHoldersAnalysis.concentration?.top5Holdings || 0), 0) / holdersRecords.length;

        const avgWhaleCount = holdersRecords.reduce((sum, r) => 
            sum + (r.analysis.topHoldersAnalysis.whaleCount || 0), 0) / holdersRecords.length;

        const avgFreshWalletCount = holdersRecords.reduce((sum, r) => 
            sum + (r.analysis.topHoldersAnalysis.freshWalletCount || 0), 0) / holdersRecords.length;

        // Concentration distribution
        const concentrationRanges = {
            'Low (0-50%)': 0,
            'Medium (50-70%)': 0,
            'High (70-85%)': 0,
            'Very High (85-95%)': 0,
            'Extreme (95-100%)': 0
        };

        holdersRecords.forEach(r => {
            const top10 = r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0;
            if (top10 < 50) concentrationRanges['Low (0-50%)']++;
            else if (top10 < 70) concentrationRanges['Medium (50-70%)']++;
            else if (top10 < 85) concentrationRanges['High (70-85%)']++;
            else if (top10 < 95) concentrationRanges['Very High (85-95%)']++;
            else concentrationRanges['Extreme (95-100%)']++;
        });

        console.log(`\n👥 Top Holders Analysis (${holdersRecords.length} analyzed):`);
        console.log(`   • Average Top 10 Holdings: ${avgTop10Holdings.toFixed(2)}% ⭐`);
        console.log(`   • Average Top 5 Holdings: ${avgTop5Holdings.toFixed(2)}%`);
        console.log(`   • Average Whale Count: ${avgWhaleCount.toFixed(1)}/20`);
        console.log(`   • Average Fresh Wallet Count: ${avgFreshWalletCount.toFixed(1)}/20`);

        console.log(`\n   📊 Top 10 Concentration Distribution:`);
        Object.entries(concentrationRanges).forEach(([range, count]) => {
            const percentage = holdersRecords.length > 0 ? (count / holdersRecords.length * 100).toFixed(1) : '0';
            console.log(`      ${range}: ${count} (${percentage}%)`);
        });

        // Show most concentrated tokens
        const highConcentration = holdersRecords
            .filter(r => (r.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0) > 90)
            .sort((a, b) => (b.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0) - 
                           (a.analysis.topHoldersAnalysis.concentration?.top10Holdings || 0))
            .slice(0, 5);

        if (highConcentration.length > 0) {
            console.log(`\n   🎯 Most Concentrated Tokens:`);
            highConcentration.forEach((record, i) => {
                const holders = record.analysis.topHoldersAnalysis;
                console.log(`      ${i + 1}. ${record.symbol}: ${holders.concentration.top10Holdings.toFixed(1)}% top 10, ${holders.whaleCount} whales, ${holders.freshWalletCount} fresh`);
            });
        }
    }

    analyzeRiskDistribution(records) {
        const analyzedRecords = records.filter(r => r.analysis?.success);
        
        if (analyzedRecords.length === 0) {
            console.log(`\n⚠️ Risk Analysis: No successful analysis data found`);
            return;
        }

        const riskDistribution = {
            'LOW': 0,
            'MEDIUM': 0,
            'HIGH': 0,
            'VERY_HIGH': 0,
            'UNKNOWN': 0
        };

        analyzedRecords.forEach(r => {
            const riskLevel = r.analysis?.topHoldersAnalysis?.riskLevel || 'UNKNOWN';
            riskDistribution[riskLevel] = (riskDistribution[riskLevel] || 0) + 1;
        });

        console.log(`\n⚠️ Risk Level Distribution (${analyzedRecords.length} analyzed):`);
        Object.entries(riskDistribution).forEach(([level, count]) => {
            const percentage = analyzedRecords.length > 0 ? (count / analyzedRecords.length * 100).toFixed(1) : '0';
            const emoji = level === 'LOW' ? '🟢' : level === 'MEDIUM' ? '🟡' : level === 'HIGH' ? '🟠' : level === 'VERY_HIGH' ? '🔴' : '⚪';
            console.log(`   ${emoji} ${level}: ${count} (${percentage}%)`);
        });
    }

    findInterestingPatterns(records) {
        console.log(`\n🔍 Interesting Patterns & Insights:`);

        // Find tokens with both high bundle activity AND high concentration
        const doubleRisk = records.filter(r => {
            const bundlePercentage = r.analysis?.bundleAnalysis?.percentageBundled || 0;
            const top10Holdings = r.analysis?.topHoldersAnalysis?.concentration?.top10Holdings || 0;
            return bundlePercentage > 30 && top10Holdings > 85;
        });

        if (doubleRisk.length > 0) {
            console.log(`\n⚠️ Double Risk Tokens (High Bundle + High Concentration): ${doubleRisk.length}`);
            doubleRisk.slice(0, 3).forEach((record, i) => {
                const bundle = record.analysis.bundleAnalysis.percentageBundled;
                const concentration = record.analysis.topHoldersAnalysis.concentration.top10Holdings;
                console.log(`   ${i + 1}. ${record.symbol}: ${bundle.toFixed(1)}% bundled, ${concentration.toFixed(1)}% top 10 concentration`);
            });
        }

        // Find tokens with perfect concentration (100% top 10)
        const perfectConcentration = records.filter(r => {
            const top10 = r.analysis?.topHoldersAnalysis?.concentration?.top10Holdings || 0;
            return top10 >= 99.9; // Account for floating point precision
        });

        if (perfectConcentration.length > 0) {
            console.log(`\n🎯 Perfect Concentration (≥99.9% Top 10): ${perfectConcentration.length}`);
            perfectConcentration.slice(0, 3).forEach((record, i) => {
                const holders = record.analysis.topHoldersAnalysis;
                console.log(`   ${i + 1}. ${record.symbol}: ${holders.concentration.top10Holdings.toFixed(2)}% (${holders.whaleCount} whales, ${holders.freshWalletCount} fresh)`);
            });
        }

        // Find correlation between Twitter engagement and risk
        const highEngagement = records.filter(r => (r.likes || 0) > 1000);
        const highEngagementLowRisk = highEngagement.filter(r => {
            const bundle = r.analysis?.bundleAnalysis?.percentageBundled || 0;
            const concentration = r.analysis?.topHoldersAnalysis?.concentration?.top10Holdings || 0;
            return bundle < 10 && concentration < 70;
        });

        console.log(`\n📈 Engagement vs Risk Correlation:`);
        console.log(`   • High engagement tokens (>1k likes): ${highEngagement.length}`);
        console.log(`   • High engagement + Low risk: ${highEngagementLowRisk.length}`);
        if (highEngagement.length > 0) {
            const lowRiskRate = (highEngagementLowRisk.length / highEngagement.length * 100).toFixed(1);
            console.log(`   • Low risk rate for high engagement: ${lowRiskRate}%`);
        }
    }

    formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toFixed(0);
    }

    // Export findings to a summary file
    async exportSummary(records) {
        try {
            const summary = {
                generatedAt: new Date().toISOString(),
                totalRecords: records.length,
                creationRecords: records.filter(r => r.eventType === 'creation').length,
                migrationRecords: records.filter(r => r.eventType === 'migration').length,
                // Add your key metrics here
                keyMetrics: {
                    averageTop10Holdings: this.calculateAverage(records, 'analysis.topHoldersAnalysis.concentration.top10Holdings'),
                    averageBundlePercentage: this.calculateAverage(records, 'analysis.bundleAnalysis.percentageBundled'),
                    bundleDetectionRate: this.calculateDetectionRate(records),
                    averageTwitterLikes: this.calculateAverage(records, 'likes'),
                    averageTwitterViews: this.calculateAverage(records, 'views')
                }
            };

            const filename = `metrics_summary_${new Date().toISOString().split('T')[0]}.json`;
            const filepath = path.join(this.scanResultsDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(summary, null, 2));
            console.log(`\n💾 Summary exported to: ${filename}`);

        } catch (error) {
            console.error('❌ Error exporting summary:', error.message);
        }
    }

    calculateAverage(records, path) {
        const values = records.map(r => this.getNestedValue(r, path)).filter(v => v !== null && !isNaN(v));
        return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    }

    calculateDetectionRate(records) {
        const bundleRecords = records.filter(r => r.analysis?.bundleAnalysis);
        if (bundleRecords.length === 0) return 0;
        const detected = bundleRecords.filter(r => r.analysis.bundleAnalysis.detected).length;
        return (detected / bundleRecords.length) * 100;
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }
}

// Usage
async function main() {
    const analyzer = new EnhancedMetricsAnalyzer();
    await analyzer.analyzeAllMetrics();
}

// Export for use as module
module.exports = EnhancedMetricsAnalyzer;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    });
}