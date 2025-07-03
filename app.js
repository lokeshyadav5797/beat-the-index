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
const errorDiv = document.getElementById('error-message');
const chartCanvas = document.getElementById('performance-chart');
const summaryStatsDiv = document.getElementById('summary-stats');
const intervalGroup = document.getElementById('interval-group');
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
    errorDiv.textContent = msg;
}

// Utility: Clear error
function clearError() {
    errorDiv.textContent = '';
}

// Fetch historical data from Yahoo Finance (no API key required)
async function fetchStockData(symbol, intervalKey) {
    const { range, interval } = INTERVAL_MAP[intervalKey];
    // Yahoo Finance unofficial endpoint (CORS proxy needed for browser)
    const proxy = 'https://corsproxy.io/?';
    const url = `${proxy}https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includeAdjustedClose=true`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Network error');
    const data = await resp.json();
    if (!data.chart || data.chart.error) {
        throw new Error(data.chart?.error?.description || 'API error');
    }
    const result = data.chart.result[0];
    if (!result) throw new Error('No data found for ' + symbol);
    return result;
}

// Parse and align data for charting (Yahoo Finance)
function processData(yahooResult, days) {
    const timestamps = yahooResult.timestamp;
    const prices = yahooResult.indicators.adjclose[0].adjclose;
    // Convert timestamps to YYYY-MM-DD
    const dates = timestamps.map(ts => {
        const d = new Date(ts * 1000);
        return d.toISOString().slice(0, 10);
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
function renderChart(labels, relativeData, scaleType, mainLabel, benchmarkLabel) {
    if (chartInstance) chartInstance.destroy();
    // Convert labels to date objects for time scale
    const dateObjs = labels.map(d => new Date(d));
    chartInstance = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: dateObjs,
            datasets: [
                {
                    label: '',
                    data: relativeData,
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    hoverRadius: 6,
                    pointBackgroundColor: '#1976d2',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHitRadius: 8,
                    pointHoverBackgroundColor: '#1976d2',
                    segment: {
                        borderColor: ctx => {
                            // ctx.p0.parsed.y, ctx.p1.parsed.y are the y values of the segment ends
                            const y0 = ctx.p0.parsed.y;
                            const y1 = ctx.p1.parsed.y;
                            // Average value for the segment
                            const avg = (y0 + y1) / 2;
                            if (avg >= 1) {
                                // Green, darker as value increases
                                // Clamp intensity for safety
                                const intensity = Math.min(1, (avg - 1) / 0.5); // 0 at 1, 1 at 1.5+
                                // From #4caf50 (light green) to #145a18 (dark green)
                                const r = Math.round(76 - 62 * intensity); // 76 to 14
                                const g = Math.round(175 - 81 * intensity); // 175 to 94
                                const b = Math.round(80 - 62 * intensity); // 80 to 18
                                return `rgb(${r},${g},${b})`;
                            } else {
                                // Red, darker as value decreases
                                // Clamp intensity for safety
                                const intensity = Math.min(1, (1 - avg) / 0.5); // 0 at 1, 1 at 0.5 or less
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
                tooltip: { mode: 'nearest', intersect: false },
            },
            scales: {
                y: {
                    type: scaleType,
                    title: { display: true, text: 'Relative Growth' },
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
                    title: { display: true, text: 'Date' },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 8,
                        major: { enabled: true },
                        font: { weight: 'bold' },
                        color: '#1976d2',
                        maxRotation: 0,
                        minRotation: 0
                    },
                    grid: {
                        drawOnChartArea: false
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
    const mainAvg = averageDailyReturn(main.prices).toFixed(2);
    const benchAvg = averageDailyReturn(benchmark.prices).toFixed(2);
    summaryStatsDiv.innerHTML = `
        <strong>${mainLabel}</strong>: ${mainGrowth}% total, CAGR: ${mainCAGR}%, Avg Daily: ${mainAvg}%<br>
        <strong>${benchmarkLabel}</strong>: ${benchGrowth}% total, CAGR: ${benchCAGR}%, Avg Daily: ${benchAvg}%
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
updateIntervalButtons();

intervalGroup.addEventListener('click', (e) => {
    if (e.target.classList.contains('interval-btn')) {
        selectedInterval = e.target.dataset.value;
        // Remove 'selected' from all, add to clicked
        document.querySelectorAll('.interval-btn').forEach(btn => btn.classList.remove('selected'));
        e.target.classList.add('selected');
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
        }
    });
}

// Main form handler
form.addEventListener('submit', async (e) => {
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
        renderChart(commonDates, relativePrices, scaleType, mainTicker, benchmarkTicker);
    } catch (err) {
        showError(err.message || 'Failed to fetch data.');
        if (chartInstance) chartInstance.destroy();
    } finally {
        setLoading(false);
    }
}); 