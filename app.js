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
const yearDropdownContainer = document.getElementById('year-dropdown-container');
const yearSelect = document.getElementById('year-select');
let selectedInterval = '1y'; // Default
let selectedBenchmark = 'VOO';
let selectedYear = 2017; // Default to 2017
console.log('Initial selectedYear:', selectedYear);
const priceTypeDropdown = document.getElementById('price-type-toggle-dropdown');
const priceTypeToggleBtn = document.getElementById('price-type-toggle');
const priceTypeMenu = priceTypeDropdown ? priceTypeDropdown.querySelector('.dropdown-menu') : null;
let selectedPriceType = 'close';

let chartInstance = null;

const compareBtn = form.querySelector('button[type="submit"]');
const loadingBtnText = document.getElementById('loading-btn-text');
let loadingTimeout = null;

// Map UI interval to Yahoo Finance range/interval
const INTERVAL_MAP = {
    '30d': { range: '1mo', interval: '1d', days: 30 },
    '90d': { range: '3mo', interval: '1d', days: 90 },
    '6mo': { range: '6mo', interval: '1d', days: 182 },
    'ytd': { range: 'ytd', interval: '1d', days: 0 }, // Will be calculated dynamically
    '1y': { range: '1y', interval: '1d', days: 365 },
    '5y': { range: '5y', interval: '1wk', days: 365*5 },
    '10y': { range: '10y', interval: '1wk', days: 365*10 },
    'since': { range: 'max', interval: '1wk', days: -1 }, // Will be calculated dynamically based on selected year
};

// Utility: Show/hide loading in button after 2s delay
function setLoading(isLoading) {
    if (isLoading) {
        // Set a timeout to show loading after 2 seconds
        loadingTimeout = setTimeout(() => {
            if (loadingBtnText) loadingBtnText.textContent = 'Loading...';
            if (compareBtn) compareBtn.disabled = true;
        }, 2000);
    } else {
        clearTimeout(loadingTimeout);
        if (loadingBtnText) loadingBtnText.textContent = 'Compare';
        if (compareBtn) compareBtn.disabled = false;
    }
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
async function fetchStockData(symbol, intervalKey, priceType) {
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
function processData(yahooResult, days, priceType) {
    const timestamps = yahooResult.timestamp;
    let prices;
    if (priceType === 'adjclose') {
        prices = yahooResult.indicators.adjclose[0].adjclose;
    } else {
        prices = yahooResult.indicators.quote[0].close;
    }
    // Convert timestamps to YYYY-MM-DD in PST timezone
    const dates = timestamps.map(ts => {
        const d = new Date(ts * 1000);
        // Convert to PST (UTC-8) or PDT (UTC-7) based on daylight saving
        const pstDate = new Date(d.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
        return pstDate.toISOString().slice(0, 10);
    });
    
    // Handle YTD case - calculate actual days from start of year
    let actualDays = days;
    if (days === 0) { // YTD case
        const currentDate = new Date();
        const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // January 1st of current year
        actualDays = Math.ceil((currentDate - startOfYear) / (1000 * 60 * 60 * 24));
        
        // Only keep last N days (if available)
        const slicedDates = dates.slice(-actualDays);
        const slicedPrices = prices.slice(-actualDays);
        return { dates: slicedDates, prices: slicedPrices };
    } else if (days === -1) { // Since case - filter by actual date range
        const currentDate = new Date();
        const startOfSelectedYear = new Date(selectedYear, 0, 1); // January 1st of selected year
        const startOfSelectedYearStr = startOfSelectedYear.toISOString().slice(0, 10);
        
        console.log('Since case: filtering data from', startOfSelectedYearStr, 'to current date');
        console.log('Since case: selectedYear =', selectedYear, 'startOfSelectedYear =', startOfSelectedYear);
        console.log('Since case: original data has', dates.length, 'data points');
        
        // Filter data to only include dates from the selected year onwards
        const filteredData = dates.map((date, index) => ({ date, price: prices[index] }))
            .filter(item => item.date >= startOfSelectedYearStr)
            .filter(item => item.price !== null && item.price !== undefined); // Remove any null/undefined prices
        
        const filteredDates = filteredData.map(item => item.date);
        const filteredPrices = filteredData.map(item => item.price);
        
        console.log('Since case: filtered data from', dates.length, 'data points to', filteredDates.length, 'data points');
        
        // If no data found after filtering, try to find the earliest available data
        if (filteredDates.length === 0) {
            console.log('Since case: no data found after filtering! Trying to find earliest available data...');
            
            // Find the earliest available data point
            const validData = dates.map((date, index) => ({ date, price: prices[index] }))
                .filter(item => item.price !== null && item.price !== undefined);
            
            if (validData.length > 0) {
                // Sort by date to find the earliest
                validData.sort((a, b) => a.date.localeCompare(b.date));
                const earliestDate = validData[0].date;
                console.log('Since case: earliest available data is from', earliestDate);
                
                // Use all available data from the earliest date
                const fallbackDates = validData.map(item => item.date);
                const fallbackPrices = validData.map(item => item.price);
                
                console.log('Since case: using fallback data from', fallbackDates.length, 'data points');
                console.log('Since case: fallback date range from', fallbackDates[0], 'to', fallbackDates[fallbackDates.length - 1]);
                
                return { dates: fallbackDates, prices: fallbackPrices };
            } else {
                console.log('Since case: no valid data found at all!');
                throw new Error(`No data available for the selected time period. Try selecting a different year or time interval.`);
            }
        }
        
        if (filteredDates.length > 0) {
            console.log('Since case: date range from', filteredDates[0], 'to', filteredDates[filteredDates.length - 1]);
        }
        
        return { dates: filteredDates, prices: filteredPrices };
    } else {
        // Only keep last N days (if available) for other intervals
        const slicedDates = dates.slice(-actualDays);
        const slicedPrices = prices.slice(-actualDays);
        return { dates: slicedDates, prices: slicedPrices };
    }
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
    console.log('renderChart called with:', { labels: labels.length, relativeData: relativeData.length, mainPrices: mainPrices.length, benchPrices: benchPrices.length });
    
    if (chartInstance) {
        console.log('Destroying existing chart instance');
        chartInstance.destroy();
    }
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
    
    // Get the latest value of growth
    const latestGrowth = percentageData[percentageData.length - 1];
    // Choose a color for the annotation and tick
    const annotationColor = latestGrowth >= 0 ? '#38a169' : '#e53e3e'; // green for positive, red for negative
    
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
                annotation: {
                    annotations: {
                        latestGrowthLine: {
                            type: 'line',
                            yMin: latestGrowth,
                            yMax: latestGrowth,
                            borderColor: annotationColor,
                            borderWidth: 2,
                            borderDash: [6, 6],
                            label: {
                                display: true,
                                content: latestGrowth.toFixed(2) + '%',
                                position: 'end',
                                backgroundColor: annotationColor,
                                color: '#fff',
                                font: {
                                    weight: 'bold',
                                    size: 12
                                },
                                xAdjust: 10,
                                yAdjust: 0,
                                padding: 6,
                                cornerRadius: 6
                            }
                        },
                        zeroLine: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: '#000',
                            borderWidth: 2,
                            borderDash: [],
                            label: {
                                display: true,
                                content: '0%',
                                position: 'end',
                                backgroundColor: '#000',
                                color: '#fff',
                                font: {
                                    weight: 'bold',
                                    size: 12
                                },
                                xAdjust: 10,
                                yAdjust: 0,
                                padding: 6,
                                cornerRadius: 6
                            }
                        }
                    }
                }
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
                        color: function(context) {
                            // Highlight the latest value tick in annotationColor
                            if (context.tick.value === Math.round(latestGrowth * 100) / 100) {
                                return annotationColor;
                            }
                            return textColor;
                        },
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
                y2: {
                    position: 'right',
                    display: true,
                    grid: { drawOnChartArea: false, display: false },
                    ticks: {
                        color: annotationColor,
                        font: { size: 14, weight: 'bold' },
                        callback: function(value) {
                            // Only show the latest growth value
                            if (Math.abs(value - latestGrowth) < 0.01) {
                                return latestGrowth.toFixed(2) + '%';
                            }
                            return '';
                        },
                        major: { enabled: true },
                        minRotation: 0,
                        maxRotation: 0,
                        autoSkip: false,
                        padding: 8
                    },
                    min: function(context) {
                        const min = context.chart.data.datasets[0].data.reduce((a, b) => Math.min(a, b), Infinity);
                        return Math.min(min, -5);
                    },
                    max: function(context) {
                        const max = context.chart.data.datasets[0].data.reduce((a, b) => Math.max(a, b), -Infinity);
                        return Math.max(max, 5);
                    },
                    title: { display: false },
                    border: { display: false },
                    afterBuildTicks: function(axis) {
                        axis.ticks = [{ value: latestGrowth }];
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
    let days = INTERVAL_MAP[intervalKey].days;
    let years = days / 365;
    
    // Handle YTD case - calculate actual days from start of year
    if (days === 0) { // YTD case
        const currentDate = new Date();
        const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // January 1st of current year
        days = Math.ceil((currentDate - startOfYear) / (1000 * 60 * 60 * 24));
        years = days / 365;
    } else if (days === -1) { // Since case - calculate days from selected year to current date
        const currentDate = new Date();
        const startOfSelectedYear = new Date(selectedYear, 0, 1); // January 1st of selected year
        days = Math.ceil((currentDate - startOfSelectedYear) / (1000 * 60 * 60 * 24));
        if (days < 0) days = 0; // Ensure we don't have negative days
        years = days / 365;
    }
    
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
        '30d': '30 Days', 
        '90d': '90 Days',
        '6mo': '6 Months',
        'ytd': 'Year to Date',
        '1y': '1 Year',
        '5y': '5 Years',
        '10y': '10 Years',
        'since': `Since ${selectedYear}`
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

// Populate year dropdown with available years
function populateYearDropdown() {
    console.log('populateYearDropdown called, yearSelect:', yearSelect, 'selectedYear:', selectedYear);
    if (!yearSelect) {
        console.log('yearSelect is null, returning early');
        return;
    }
    
    const currentYear = new Date().getFullYear();
    const startYear = 2011; // Start year for "Since" selection (2011 onwards)
    
    yearSelect.innerHTML = '';
    
    for (let year = currentYear; year >= startYear; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === selectedYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    }
    
    // Ensure the selected year is properly set and doesn't go below startYear
    if (selectedYear < startYear) {
        selectedYear = startYear;
    }
    yearSelect.value = selectedYear;
    console.log('Year dropdown populated, selected value:', yearSelect.value);
    console.log('Year dropdown options count:', yearSelect.options.length);
    console.log('Year dropdown innerHTML length:', yearSelect.innerHTML.length);
}

// Handle year selection change
function handleYearSelection() {
    console.log('handleYearSelection called!');
    if (yearSelect) {
        const newYear = parseInt(yearSelect.value);
        console.log('Year selection changed from', selectedYear, 'to', newYear);
        selectedYear = newYear;
        console.log('selectedYear updated to:', selectedYear);
        console.log('Current form state:', {
            mainTicker: mainTickerInput.value.trim(),
            selectedBenchmark,
            hasBenchmarkTicker: selectedBenchmark !== 'custom' || !!benchmarkTickerInput.value.trim()
        });
        
        // Auto-refresh chart if we have data to work with
        if (mainTickerInput.value.trim() && (selectedBenchmark !== 'custom' || benchmarkTickerInput.value.trim())) {
            console.log('Triggering chart refresh due to year change');
            form.dispatchEvent(new Event('submit'));
        } else {
            console.log('Not refreshing chart - conditions not met:', {
                hasMainTicker: !!mainTickerInput.value.trim(),
                hasBenchmarkTicker: selectedBenchmark !== 'custom' || !!benchmarkTickerInput.value.trim()
            });
        }
    } else {
        console.log('Warning: yearSelect is null in handleYearSelection');
    }
}

// Highlight the default interval button
function updateIntervalButtons() {
    console.log('updateIntervalButtons called, selectedInterval:', selectedInterval);
    console.log('yearDropdownContainer:', yearDropdownContainer);
    console.log('yearSelect:', yearSelect);
    
    document.querySelectorAll('.interval-btn').forEach(btn => {
        if (btn.dataset.value === selectedInterval) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    // Show/hide year dropdown based on selected interval
    if (yearDropdownContainer) {
        const shouldShow = selectedInterval === 'since';
        console.log('Should show year dropdown:', shouldShow);
        yearDropdownContainer.style.display = shouldShow ? 'block' : 'none';
        console.log('Year dropdown container display style:', yearDropdownContainer.style.display);
        
        // If showing the dropdown, make sure the selected year is properly set
        if (shouldShow && yearSelect) {
            yearSelect.value = selectedYear;
            console.log('Set yearSelect.value to:', selectedYear);
        }
    } else {
        console.log('yearDropdownContainer is null!');
    }
}

// Set default values and load initial chart
function initializeApp() {
    console.log('Initializing app...');
    
    // Populate year dropdown
    populateYearDropdown();
    
    // Update UI to reflect default selections (main ticker and benchmark are already set in HTML)
    updateIntervalButtons();
    
    // Set up year dropdown event listener once
    if (yearSelect) {
        console.log('Setting up year dropdown event listener in initializeApp');
        // Remove any existing listeners to avoid duplicates
        yearSelect.removeEventListener('change', handleYearSelection);
        yearSelect.addEventListener('change', handleYearSelection);
        console.log('Year dropdown event listener added successfully');
        
        // Ensure the year dropdown is properly set if "Since" is the default interval
        if (selectedInterval === 'since') {
            yearSelect.value = selectedYear;
            console.log('Since is default interval, set year dropdown to:', selectedYear);
        }
    } else {
        console.log('Warning: yearSelect is null in initializeApp');
    }
    
    console.log('About to trigger form submission...');
    // Load the chart with default values after a short delay to ensure everything is ready
    setTimeout(() => {
        console.log('Triggering form submission...');
        form.dispatchEvent(new Event('submit'));
    }, 100);
}

intervalGroup.addEventListener('click', (e) => {
    if (e.target.classList.contains('interval-btn')) {
        console.log('Interval button clicked:', e.target.dataset.value);
        selectedInterval = e.target.dataset.value;
        // Remove 'selected' from all, add to clicked
        document.querySelectorAll('.interval-btn').forEach(btn => btn.classList.remove('selected'));
        e.target.classList.add('selected');
        
        // Update UI to show/hide year dropdown
        updateIntervalButtons();
        
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
        selectedInterval,
        selectedPriceType
    });
    
    e.preventDefault();
    clearError();
    setLoading(true);
    
    // Add a timeout to prevent infinite loading
    const requestTimeout = setTimeout(() => {
        console.log('Request timeout reached, clearing loading state');
        setLoading(false);
        showError('Request timed out. Please try again.');
    }, 30000); // 30 second timeout
    
    try {
        const mainTicker = mainTickerInput.value.trim().toUpperCase();
        let benchmarkTicker = selectedBenchmark;
        if (benchmarkTicker === 'custom') {
            benchmarkTicker = benchmarkTickerInput.value.trim().toUpperCase();
        }
        const intervalKey = selectedInterval;
        const scaleType = 'linear';
        console.log('Form submission - selectedInterval:', selectedInterval, 'selectedYear:', selectedYear, 'days from INTERVAL_MAP:', INTERVAL_MAP[intervalKey].days);
        console.log('Processing data with selectedYear:', selectedYear);
        if (!mainTicker || !benchmarkTicker) throw new Error('Please enter both ticker symbols.');
        // Fetch data in parallel
        const [mainTS, benchTS] = await Promise.all([
            fetchStockData(mainTicker, intervalKey, selectedPriceType),
            fetchStockData(benchmarkTicker, intervalKey, selectedPriceType)
        ]);
        let days = INTERVAL_MAP[intervalKey].days;
        
        // Handle YTD case - calculate actual days from start of year
        if (days === 0) { // YTD case
            const currentDate = new Date();
            const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // January 1st of current year
            days = Math.ceil((currentDate - startOfYear) / (1000 * 60 * 60 * 24));
            console.log('YTD case: calculated days =', days);
        }
        // Note: Since case (days === -1) is handled in processData function
        
        const main = processData(mainTS, days, selectedPriceType);
        const bench = processData(benchTS, days, selectedPriceType);
        
        // Validate that we have data after processing
        if (main.dates.length === 0 || bench.dates.length === 0) {
            throw new Error(`No data available for ${main.dates.length === 0 ? mainTicker : benchmarkTicker} in the selected time period. Try selecting a different year or time interval.`);
        }
        
        console.log('Data processed successfully:', {
            main: { dates: main.dates.length, prices: main.prices.length },
            bench: { dates: bench.dates.length, prices: bench.prices.length }
        });
        
        // Align dates (intersection)
        const commonDates = main.dates.filter(d => bench.dates.includes(d));
        
        if (commonDates.length === 0) {
            throw new Error('No overlapping dates found between the two stocks. Try selecting a different time period.');
        }
        
        const mainIdx = main.dates.map((d, i) => commonDates.includes(d) ? i : -1).filter(i => i !== -1);
        const benchIdx = bench.dates.map((d, i) => commonDates.includes(d) ? i : -1).filter(i => i !== -1);
        const mainPrices = mainIdx.map(i => main.prices[i]);
        const benchPrices = benchIdx.map(i => bench.prices[i]);
        // Compute relative price (stock / benchmark), normalized to 1.0
        const relativePricesRaw = mainPrices.map((p, i) => p / benchPrices[i]);
        const relativePrices = normalizeToOne(relativePricesRaw);
        
        console.log('Chart data prepared:', {
            commonDates: commonDates.length,
            mainPrices: mainPrices.length,
            benchPrices: benchPrices.length,
            relativePrices: relativePrices.length
        });
        
        console.log('About to render chart...');
        renderChart(commonDates, relativePrices, scaleType, mainTicker, benchmarkTicker, mainPrices, benchPrices);
        console.log('Chart rendered successfully');
        renderSummaryStats(main, bench, intervalKey, mainTicker, benchmarkTicker);
    } catch (err) {
        console.error('Error in form submission:', err);
        showError(err.message || 'Failed to fetch data.');
        if (chartInstance) chartInstance.destroy();
    } finally {
        clearTimeout(requestTimeout);
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
    console.log('DOMContentLoaded event fired');
    console.log('yearSelect element:', yearSelect);
    console.log('yearDropdownContainer element:', yearDropdownContainer);
    
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

function setPriceType(value, label) {
    selectedPriceType = value;
    priceTypeToggleBtn.textContent = label;
    // Update aria-selected
    priceTypeMenu.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.setAttribute('aria-selected', opt.dataset.value === value ? 'true' : 'false');
    });
    // Close menu
    priceTypeDropdown.setAttribute('aria-expanded', 'false');
    priceTypeMenu.style.display = 'none';
    // Auto-refresh chart if we have data to work with
    if (mainTickerInput.value.trim() && (selectedBenchmark !== 'custom' || benchmarkTickerInput.value.trim())) {
        form.dispatchEvent(new Event('submit'));
    }
}

if (priceTypeDropdown && priceTypeToggleBtn && priceTypeMenu) {
    priceTypeDropdown.setAttribute('aria-expanded', 'false');
    priceTypeToggleBtn.addEventListener('click', (e) => {
        const expanded = priceTypeDropdown.getAttribute('aria-expanded') === 'true';
        priceTypeDropdown.setAttribute('aria-expanded', String(!expanded));
        priceTypeMenu.style.display = !expanded ? 'block' : 'none';
    });
    // Allow clicking the label to open the dropdown
    const priceTypeLabel = document.querySelector('label[for="price-type-toggle-dropdown"]');
    if (priceTypeLabel) {
        priceTypeLabel.addEventListener('click', () => {
            priceTypeDropdown.setAttribute('aria-expanded', 'true');
            priceTypeMenu.style.display = 'block';
            priceTypeMenu.querySelector('.dropdown-option[aria-selected="true"]').focus();
        });
    }
    priceTypeToggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            priceTypeDropdown.setAttribute('aria-expanded', 'true');
            priceTypeMenu.style.display = 'block';
            priceTypeMenu.querySelector('.dropdown-option[aria-selected="true"]').focus();
        }
    });
    priceTypeMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-option')) {
            setPriceType(e.target.dataset.value, e.target.textContent);
        }
    });
    // Keyboard navigation for options
    priceTypeMenu.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.tabIndex = 0;
        opt.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                (opt.nextElementSibling || priceTypeMenu.firstElementChild).focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                (opt.previousElementSibling || priceTypeMenu.lastElementChild).focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setPriceType(opt.dataset.value, opt.textContent);
            } else if (e.key === 'Escape') {
                priceTypeDropdown.setAttribute('aria-expanded', 'false');
                priceTypeMenu.style.display = 'none';
                priceTypeToggleBtn.focus();
            }
        });
    });
    // Close dropdown on outside click
    document.addEventListener('mousedown', (e) => {
        if (!priceTypeDropdown.contains(e.target)) {
            priceTypeDropdown.setAttribute('aria-expanded', 'false');
            priceTypeMenu.style.display = 'none';
        }
    });
    // Close dropdown on blur
    priceTypeDropdown.addEventListener('blur', () => {
        setTimeout(() => {
            if (!priceTypeDropdown.contains(document.activeElement)) {
                priceTypeDropdown.setAttribute('aria-expanded', 'false');
                priceTypeMenu.style.display = 'none';
            }
        }, 100);
    }, true);
} 