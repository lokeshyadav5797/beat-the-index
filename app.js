// Beat the Index - Main JS
// Using Yahoo Finance unofficial API (no API key required)
// const ALPHA_VANTAGE_API_KEY = 'demo'; // No longer needed
// const API_URL = 'https://www.alphavantage.co/query';

const form = document.getElementById('stock-form');
const mainTickerInput = document.getElementById('main-ticker');
const benchmarkBtnGroup = document.getElementById('benchmark-btn-group');
const benchmarkBtns = benchmarkBtnGroup ? benchmarkBtnGroup.querySelectorAll('.benchmark-btn') : [];
const benchmarkTickerInput = document.getElementById('benchmark-ticker');
const scaleToggle = document.getElementById('scale-toggle');
const loadingDiv = document.getElementById('loading');
let errorDiv = null; // Will be created dynamically when needed
const chartCanvas = document.getElementById('performance-chart');
const summaryStatsDiv = document.getElementById('summary-stats');
const intervalGroup = document.getElementById('interval-group');
const darkModeToggle = document.getElementById('dark-mode-toggle');
let selectedInterval = '1y'; // Default
let selectedBenchmark = 'VOO';

let chartInstance = null;

// Map UI interval to Yahoo Finance range/interval
const INTERVAL_MAP = {
    '5d': { range: '5d', interval: '1d', days: 5 },
    '30d': { range: '1mo', interval: '1d', days: 30 },
    '90d': { range: '3mo', interval: '1d', days: 90 },
    '6mo': { range: '6mo', interval: '1d', days: 182 },
    '1y': { range: '1y', interval: '1d', days: 365 },
    '5y': { range: '5y', interval: '1wk', days: 365*5 },
    '10y': { range: '10y', interval: '1wk', days: 365*10 },
};

// Utility: Show/hide loading
function setLoading(isLoading) {
    loadingDiv.style.display = isLoading ? 'block' : 'none';
}

// Utility: Show error
function showError(msg) {
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-message';
        document.querySelector('.left-pane').appendChild(errorDiv);
    }
    errorDiv.textContent = msg;
}

// Utility: Clear error
function clearError() {
    if (errorDiv) {
        errorDiv.remove();
        errorDiv = null;
    }
}

// Fetch historical data from Yahoo Finance (no API key required)
async function fetchStockData(symbol, intervalKey) {
    console.log(`Fetching data for ${symbol} with interval ${intervalKey}`);
    const { range, interval } = INTERVAL_MAP[intervalKey];
    // Yahoo Finance unofficial endpoint (CORS proxy needed for browser)
    const proxy = 'https://corsproxy.io/?';
    const url = `${proxy}https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includeAdjustedClose=true`;
    console.log('Fetching URL:', url);
    
    try {
        const resp = await fetch(url);
        console.log('Response status:', resp.status);
        if (!resp.ok) throw new Error(`Network error: ${resp.status}`);
        const data = await resp.json();
        console.log('Response data:', data);
        if (!data.chart || data.chart.error) {
            throw new Error(data.chart?.error?.description || 'API error');
        }
        const result = data.chart.result[0];
        if (!result) throw new Error('No data found for ' + symbol);
        return result;
    } catch (error) {
        console.error('Error fetching data for', symbol, ':', error);
        throw error;
    }
}

// Parse and align data for charting (Yahoo Finance)
function processData(yahooResult, days) {
    const timestamps = yahooResult.timestamp;
    const prices = yahooResult.indicators.adjclose[0].adjclose;
    // Convert timestamps to YYYY-MM-DD in PST timezone
    const dates = timestamps.map(ts => {
        const d = new Date(ts * 1000);
        // Convert to PST (UTC-8) or PDT (UTC-7) based on daylight saving
        const pstDate = new Date(d.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
        return pstDate.toISOString().slice(0, 10);
    });
    // Only keep last N days (if available)
    const slicedDates = dates.slice(-days);
    const slicedPrices = prices.slice(-days);
    return { dates: slicedDates, prices: slicedPrices };
}

// Normalize prices to initial value (for relative growth)
function normalizePrices(prices) {
    const base = prices[0];
    return prices.map(p => (p / base) * 100);
}

// Calculate percentage growth
function percentGrowth(prices) {
    if (prices.length < 2) return 0;
    return ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
}

// Calculate CAGR
function calculateCAGR(prices, years) {
    if (prices.length < 2 || years <= 0) return 0;
    return (Math.pow(prices[prices.length - 1] / prices[0], 1 / years) - 1) * 100;
}

// Calculate average daily return
function averageDailyReturn(prices) {
    if (prices.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < prices.length; i++) {
        sum += (prices[i] - prices[i - 1]) / prices[i - 1];
    }
    return (sum / (prices.length - 1)) * 100;
}

// Utility: Normalize array to start at 1.0
function normalizeToOne(arr) {
    const base = arr[0];
    return arr.map(v => v / base);
}

// Render Chart.js chart (single line: relative price)
function renderChart(labels, relativeData, scaleType, mainLabel, benchmarkLabel, mainPrices, benchPrices) {
    if (chartInstance) chartInstance.destroy();
    // Convert labels to date objects for time scale in PST timezone
    const dateObjs = labels.map(d => {
        // Create date in PST timezone
        const pstDate = new Date(d + 'T00:00:00');
        return new Date(pstDate.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    });
    
    // Convert relative data to percentage format (e.g., 1.15 -> 15%, 0.94 -> -6%)
    const percentageData = relativeData.map(value => (value - 1) * 100);
    
    // Determine if we should show points based on data length (for shorter intervals)
    const shouldShowPoints = percentageData.length <= 30; // Show points for 5d and 30d intervals
    
    // Get theme-aware colors
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#2d3748';
    const gridColor = isDark ? 'rgba(160, 174, 192, 0.2)' : 'rgba(226, 232, 240, 0.5)';
    const pointBorderColor = isDark ? '#2d3748' : '#fff';
    
    chartInstance = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: dateObjs,
            datasets: [
                {
                    label: '',
                    data: percentageData,
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                    fill: false,
                    tension: 0.1,
                    pointRadius: shouldShowPoints ? 7 : 0,
                    pointHoverRadius: 6,
                    hoverRadius: 6,
                    pointBackgroundColor: '#1976d2',
                    pointBorderColor: pointBorderColor,
                    pointBorderWidth: 2,
                    pointHitRadius: 8,
                    pointHoverBackgroundColor: '#1976d2',
                    segment: {
                        borderColor: ctx => {
                            // ctx.p0.parsed.y, ctx.p1.parsed.y are the y values of the segment ends
                            const y0 = ctx.p0.parsed.y;
                            const y1 = ctx.p1.parsed.y;
                            // Average value for the segment (convert back to ratio for color logic)
                            const avg = (y0 + y1) / 2;
                            if (avg >= 0) {
                                // Green, darker as value increases
                                // Clamp intensity for safety
                                const intensity = Math.min(1, avg / 50); // 0 at 0%, 1 at 50%+
                                // From #4caf50 (light green) to #145a18 (dark green)
                                const r = Math.round(76 - 62 * intensity); // 76 to 14
                                const g = Math.round(175 - 81 * intensity); // 175 to 94
                                const b = Math.round(80 - 62 * intensity); // 80 to 18
                                return `rgb(${r},${g},${b})`;
                            } else {
                                // Red, darker as value decreases
                                // Clamp intensity for safety
                                const intensity = Math.min(1, Math.abs(avg) / 50); // 0 at 0%, 1 at -50% or less
                                // From #f44336 (light red) to #7a1814 (dark red)
                                const r = Math.round(244 - 122 * intensity); // 244 to 122
                                const g = Math.round(67 - 53 * intensity); // 67 to 14
                                const b = Math.round(54 - 40 * intensity); // 54 to 14
                                return `rgb(${r},${g},${b})`;
                            }
                        }
                    }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            hover: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { 
                    mode: 'nearest', 
                    intersect: false,
                    titleFont: {
                        size: 16,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 16,
                        weight: '600'
                    },
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const relativeGrowth = context.parsed.y.toFixed(2);
                            const mainPrice = mainPrices[index] ? mainPrices[index].toFixed(2) : 'N/A';
                            const benchPrice = benchPrices[index] ? benchPrices[index].toFixed(2) : 'N/A';
                            return [
                                `Relative Growth: ${relativeGrowth}%`,
                                `${mainLabel}: $${mainPrice}`,
                                `${benchmarkLabel}: $${benchPrice}`
                            ];
                        }
                    }
                },
            },
            scales: {
                y: {
                    type: scaleType,
                    title: { 
                        display: true, 
                        text: 'Relative Growth (%)',
                        font: {
                            size: 16,
                            weight: 'bold'
                        },
                        color: textColor
                    },
                    ticks: {
                        font: {
                            size: 14,
                            weight: '600'
                        },
                        color: textColor,
                        callback: function(value) {
                            return value.toFixed(2) + '%';
                        }
                    },
                    min: function(context) {
                        const min = context.chart.data.datasets[0].data.reduce((a, b) => Math.min(a, b), Infinity);
                        return Math.min(min, -5);
                    },
                    max: function(context) {
                        const max = context.chart.data.datasets[0].data.reduce((a, b) => Math.max(a, b), -Infinity);
                        return Math.max(max, 5);
                    },
                    grid: {
                        color: gridColor
                    }
                },
                x: {
                    type: 'time',
                    time: {
                        unit: 'month',
                        displayFormats: {
                            month: 'MMM yyyy',
                            quarter: 'MMM yyyy',
                            year: 'yyyy',
                            day: 'MMM d, yyyy'
                        },
                        tooltipFormat: 'MMM d, yyyy'
                    },
                    title: { 
                        display: true, 
                        text: 'Date',
                        font: {
                            size: 16,
                            weight: 'bold'
                        },
                        color: textColor
                    },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 8,
                        major: { enabled: true },
                        font: { 
                            size: 14,
                            weight: '600' 
                        },
                        color: textColor,
                        maxRotation: 0,
                        minRotation: 0
                    },
                    grid: {
                        drawOnChartArea: false,
                        color: gridColor
                    }
                }
            }
        }
    });
}

// Render summary statistics
function renderSummaryStats(main, benchmark, intervalKey, mainLabel, benchmarkLabel) {
    const days = INTERVAL_MAP[intervalKey].days;
    const years = days / 365;
    const mainGrowth = percentGrowth(main.prices).toFixed(2);
    const benchGrowth = percentGrowth(benchmark.prices).toFixed(2);
    const mainCAGR = calculateCAGR(main.prices, years).toFixed(2);
    const benchCAGR = calculateCAGR(benchmark.prices, years).toFixed(2);
    
    // Determine performance colors
    const mainGrowthClass = parseFloat(mainGrowth) >= 0 ? 'positive' : 'negative';
    const benchGrowthClass = parseFloat(benchGrowth) >= 0 ? 'positive' : 'negative';
    const mainCAGRClass = parseFloat(mainCAGR) >= 0 ? 'positive' : 'negative';
    const benchCAGRClass = parseFloat(benchCAGR) >= 0 ? 'positive' : 'negative';
    
    // Get interval display name
    const intervalNames = {
        '5d': '5 Days',
        '30d': '30 Days', 
        '90d': '90 Days',
        '6mo': '6 Months',
        '1y': '1 Year',
        '5y': '5 Years',
        '10y': '10 Years'
    };
    
    summaryStatsDiv.innerHTML = `
        <div class="summary-grid">
            <div class="summary-item">
                <span class="summary-label">${intervalNames[intervalKey]} Performance</span>
                <span class="summary-ticker">${mainLabel}</span>
                <span class="summary-value ${mainGrowthClass}">${mainGrowth}%</span>
                <span class="summary-cagr ${mainCAGRClass}">CAGR: ${mainCAGR}%</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">${intervalNames[intervalKey]} Performance</span>
                <span class="summary-ticker">${benchmarkLabel}</span>
                <span class="summary-value ${benchGrowthClass}">${benchGrowth}%</span>
                <span class="summary-cagr ${benchCAGRClass}">CAGR: ${benchCAGR}%</span>
            </div>
        </div>
    `;
}

// Highlight the default interval button
function updateIntervalButtons() {
    document.querySelectorAll('.interval-btn').forEach(btn => {
        if (btn.dataset.value === selectedInterval) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
}

// Set default values and load initial chart
function initializeApp() {
    console.log('Initializing app...');
    
    // Update UI to reflect default selections (main ticker and benchmark are already set in HTML)
    updateIntervalButtons();
    
    console.log('About to trigger form submission...');
    // Load the chart with default values after a short delay to ensure everything is ready
    setTimeout(() => {
        console.log('Triggering form submission...');
        form.dispatchEvent(new Event('submit'));
    }, 100);
}



intervalGroup.addEventListener('click', (e) => {
    if (e.target.classList.contains('interval-btn')) {
        selectedInterval = e.target.dataset.value;
        // Remove 'selected' from all, add to clicked
        document.querySelectorAll('.interval-btn').forEach(btn => btn.classList.remove('selected'));
        e.target.classList.add('selected');
        
        // Auto-refresh chart if we have data to work with
        if (mainTickerInput.value.trim() && (selectedBenchmark !== 'custom' || benchmarkTickerInput.value.trim())) {
            // Trigger the form submission to refresh the chart
            form.dispatchEvent(new Event('submit'));
        }
    }
});

// Handle benchmark button selection
if (benchmarkBtnGroup) {
    benchmarkBtnGroup.addEventListener('click', (e) => {
        if (e.target.classList.contains('benchmark-btn')) {
            benchmarkBtns.forEach(btn => btn.classList.remove('selected'));
            e.target.classList.add('selected');
            selectedBenchmark = e.target.getAttribute('data-value');
            if (selectedBenchmark === 'custom') {
                benchmarkTickerInput.style.display = '';
                benchmarkTickerInput.focus();
            } else {
                benchmarkTickerInput.style.display = 'none';
            }
            
            // Auto-refresh chart if we have data to work with
            if (mainTickerInput.value.trim() && (selectedBenchmark !== 'custom' || benchmarkTickerInput.value.trim())) {
                // Trigger the form submission to refresh the chart
                form.dispatchEvent(new Event('submit'));
            }
        }
    });
}

// Main form handler
form.addEventListener('submit', async (e) => {
    console.log('Form submitted with:', {
        mainTicker: mainTickerInput.value.trim(),
        selectedBenchmark,
        selectedInterval
    });
    
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
        const mainTicker = mainTickerInput.value.trim().toUpperCase();
        let benchmarkTicker = selectedBenchmark;
        if (benchmarkTicker === 'custom') {
            benchmarkTicker = benchmarkTickerInput.value.trim().toUpperCase();
        }
        const intervalKey = selectedInterval;
        const scaleType = 'linear';
        if (!mainTicker || !benchmarkTicker) throw new Error('Please enter both ticker symbols.');
        // Fetch data in parallel
        const [mainTS, benchTS] = await Promise.all([
            fetchStockData(mainTicker, intervalKey),
            fetchStockData(benchmarkTicker, intervalKey)
        ]);
        const days = INTERVAL_MAP[intervalKey].days;
        const main = processData(mainTS, days);
        const bench = processData(benchTS, days);
        // Align dates (intersection)
        const commonDates = main.dates.filter(d => bench.dates.includes(d));
        const mainIdx = main.dates.map((d, i) => commonDates.includes(d) ? i : -1).filter(i => i !== -1);
        const benchIdx = bench.dates.map((d, i) => commonDates.includes(d) ? i : -1).filter(i => i !== -1);
        const mainPrices = mainIdx.map(i => main.prices[i]);
        const benchPrices = benchIdx.map(i => bench.prices[i]);
        // Compute relative price (stock / benchmark), normalized to 1.0
        const relativePricesRaw = mainPrices.map((p, i) => p / benchPrices[i]);
        const relativePrices = normalizeToOne(relativePricesRaw);
        renderChart(commonDates, relativePrices, scaleType, mainTicker, benchmarkTicker, mainPrices, benchPrices);
        renderSummaryStats(main, bench, intervalKey, mainTicker, benchmarkTicker);
    } catch (err) {
        showError(err.message || 'Failed to fetch data.');
        if (chartInstance) chartInstance.destroy();
    } finally {
        setLoading(false);
    }
});

// Dark Mode Toggle Functionality
function initDarkMode() {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Update chart colors if chart exists
    if (chartInstance) {
        updateChartTheme();
    }
}

function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update chart colors
    if (chartInstance) {
        updateChartTheme();
    }
}

function updateChartTheme() {
    if (!chartInstance) return;
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#2d3748';
    const gridColor = isDark ? 'rgba(160, 174, 192, 0.2)' : 'rgba(226, 232, 240, 0.5)';
    
    // Update chart options
    chartInstance.options.plugins.legend.labels.color = textColor;
    chartInstance.options.scales.x.ticks.color = textColor;
    chartInstance.options.scales.y.ticks.color = textColor;
    chartInstance.options.scales.x.title.color = textColor;
    chartInstance.options.scales.y.title.color = textColor;
    chartInstance.options.scales.x.grid.color = gridColor;
    chartInstance.options.scales.y.grid.color = gridColor;
    
    chartInstance.update();
}

// Initialize dark mode when page loads
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    
    // Add event listener for dark mode toggle
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', toggleDarkMode);
    }
    
    // Wait for Chart.js to be available
    if (typeof Chart === 'undefined') {
        console.log('Chart.js not loaded yet, waiting...');
        setTimeout(() => {
            updateIntervalButtons();
            initializeApp();
        }, 500);
    } else {
        console.log('Chart.js is available, initializing...');
        updateIntervalButtons();
        initializeApp();
    }
}); 