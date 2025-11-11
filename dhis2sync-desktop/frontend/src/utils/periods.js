/**
 * DHIS2 Period Generation Utilities
 * Generates periods in DHIS2 format based on period type
 */

/**
 * Generate periods of a specific type
 * @param {string} periodType - DHIS2 period type (Monthly, Weekly, Daily, etc.)
 * @param {number} count - Number of recent periods to generate
 * @param {Date} referenceDate - Reference date (defaults to today)
 * @returns {Array<{id: string, name: string}>} Array of period objects
 */
export function generatePeriods(periodType, count = 6, referenceDate = new Date()) {
    switch (periodType) {
        case 'Daily':
            return generateDailyPeriods(count, referenceDate);
        case 'Weekly':
            return generateWeeklyPeriods(count, referenceDate);
        case 'WeeklyWednesday':
            return generateWeeklyPeriods(count, referenceDate, 3); // Wednesday
        case 'WeeklyThursday':
            return generateWeeklyPeriods(count, referenceDate, 4); // Thursday
        case 'WeeklySaturday':
            return generateWeeklyPeriods(count, referenceDate, 6); // Saturday
        case 'WeeklySunday':
            return generateWeeklyPeriods(count, referenceDate, 0); // Sunday
        case 'BiWeekly':
            return generateBiWeeklyPeriods(count, referenceDate);
        case 'Monthly':
            return generateMonthlyPeriods(count, referenceDate);
        case 'BiMonthly':
            return generateBiMonthlyPeriods(count, referenceDate);
        case 'Quarterly':
            return generateQuarterlyPeriods(count, referenceDate);
        case 'SixMonthly':
            return generateSixMonthlyPeriods(count, referenceDate);
        case 'SixMonthlyApril':
            return generateSixMonthlyPeriods(count, referenceDate, 3); // April start
        case 'Yearly':
            return generateYearlyPeriods(count, referenceDate);
        case 'FinancialApril':
            return generateFinancialYearPeriods(count, referenceDate, 3); // April
        case 'FinancialJuly':
            return generateFinancialYearPeriods(count, referenceDate, 6); // July
        case 'FinancialOct':
            return generateFinancialYearPeriods(count, referenceDate, 9); // October
        case 'FinancialNov':
            return generateFinancialYearPeriods(count, referenceDate, 10); // November
        default:
            console.warn(`Unsupported period type: ${periodType}, defaulting to Monthly`);
            return generateMonthlyPeriods(count, referenceDate);
    }
}

/**
 * Generate daily periods (format: YYYYMMDD)
 */
function generateDailyPeriods(count, referenceDate) {
    const periods = [];
    const date = new Date(referenceDate);

    for (let i = 0; i < count; i++) {
        const current = new Date(date);
        current.setDate(date.getDate() - i);

        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');

        periods.push({
            id: `${year}${month}${day}`,
            name: current.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            })
        });
    }

    return periods;
}

/**
 * Generate weekly periods (format: YYYYWn)
 * @param {number} weekStartDay - 0 = Sunday, 1 = Monday, etc.
 */
function generateWeeklyPeriods(count, referenceDate, weekStartDay = 1) {
    const periods = [];
    const date = new Date(referenceDate);

    // Adjust to the start of the current week
    const dayOfWeek = date.getDay();
    const diff = (dayOfWeek + 7 - weekStartDay) % 7;
    date.setDate(date.getDate() - diff);

    for (let i = 0; i < count; i++) {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - (i * 7));

        const year = weekStart.getFullYear();
        const weekNumber = getWeekNumber(weekStart, weekStartDay);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        periods.push({
            id: `${year}W${weekNumber}`,
            name: `Week ${weekNumber} ${year} (${formatShortDate(weekStart)} - ${formatShortDate(weekEnd)})`
        });
    }

    return periods;
}

/**
 * Generate bi-weekly periods (format: YYYYBiWn)
 */
function generateBiWeeklyPeriods(count, referenceDate) {
    const periods = [];
    const date = new Date(referenceDate);

    // Start from beginning of year
    const yearStart = new Date(date.getFullYear(), 0, 1);
    const daysSinceYearStart = Math.floor((date - yearStart) / (1000 * 60 * 60 * 24));
    const currentBiWeek = Math.floor(daysSinceYearStart / 14);

    for (let i = 0; i < count; i++) {
        const biWeekNumber = currentBiWeek - i;
        const year = date.getFullYear();

        if (biWeekNumber < 1) continue; // Skip if goes to previous year

        const biWeekStart = new Date(yearStart);
        biWeekStart.setDate(1 + ((biWeekNumber - 1) * 14));

        const biWeekEnd = new Date(biWeekStart);
        biWeekEnd.setDate(biWeekStart.getDate() + 13);

        periods.push({
            id: `${year}BiW${biWeekNumber}`,
            name: `Bi-Week ${biWeekNumber} ${year} (${formatShortDate(biWeekStart)} - ${formatShortDate(biWeekEnd)})`
        });
    }

    return periods;
}

/**
 * Generate monthly periods (format: YYYYMM)
 */
function generateMonthlyPeriods(count, referenceDate) {
    const periods = [];
    const date = new Date(referenceDate);

    for (let i = 0; i < count; i++) {
        const current = new Date(date.getFullYear(), date.getMonth() - i, 1);

        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');

        periods.push({
            id: `${year}${month}`,
            name: current.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long'
            })
        });
    }

    return periods;
}

/**
 * Generate bi-monthly periods (format: YYYYMMBn)
 */
function generateBiMonthlyPeriods(count, referenceDate) {
    const periods = [];
    const date = new Date(referenceDate);
    const monthPairs = [
        [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]
    ];

    const currentMonth = date.getMonth() + 1; // 1-based
    const currentPairIndex = Math.floor((currentMonth - 1) / 2);

    for (let i = 0; i < count; i++) {
        let pairIndex = currentPairIndex - i;
        let year = date.getFullYear();

        // Handle year rollover
        while (pairIndex < 0) {
            pairIndex += 6;
            year--;
        }

        const [month1, month2] = monthPairs[pairIndex];
        const biMonthNumber = pairIndex + 1;

        const startDate = new Date(year, month1 - 1, 1);
        const endDate = new Date(year, month2, 0); // Last day of month2

        periods.push({
            id: `${year}${String(month1).padStart(2, '0')}B`,
            name: `${startDate.toLocaleDateString('en-US', { month: 'short' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
        });
    }

    return periods;
}

/**
 * Generate quarterly periods (format: YYYYQ[1-4])
 */
function generateQuarterlyPeriods(count, referenceDate) {
    const periods = [];
    const date = new Date(referenceDate);

    const currentQuarter = Math.floor(date.getMonth() / 3) + 1;

    for (let i = 0; i < count; i++) {
        let quarter = currentQuarter - i;
        let year = date.getFullYear();

        // Handle year rollover
        while (quarter < 1) {
            quarter += 4;
            year--;
        }

        const quarterMonths = {
            1: 'Jan - Mar',
            2: 'Apr - Jun',
            3: 'Jul - Sep',
            4: 'Oct - Dec'
        };

        periods.push({
            id: `${year}Q${quarter}`,
            name: `Q${quarter} ${year} (${quarterMonths[quarter]})`
        });
    }

    return periods;
}

/**
 * Generate six-monthly periods (format: YYYYS[1-2])
 * @param {number} startMonth - 0 = January start, 3 = April start
 */
function generateSixMonthlyPeriods(count, referenceDate, startMonth = 0) {
    const periods = [];
    const date = new Date(referenceDate);

    const adjustedMonth = (date.getMonth() - startMonth + 12) % 12;
    const currentSemester = Math.floor(adjustedMonth / 6) + 1;

    for (let i = 0; i < count; i++) {
        let semester = currentSemester - i;
        let year = date.getFullYear();

        // Handle year rollover
        while (semester < 1) {
            semester += 2;
            year--;
        }

        const semesterStart = new Date(year, startMonth + ((semester - 1) * 6), 1);
        const semesterEnd = new Date(year, startMonth + (semester * 6), 0);

        periods.push({
            id: `${year}S${semester}`,
            name: `S${semester} ${year} (${semesterStart.toLocaleDateString('en-US', { month: 'short' })} - ${semesterEnd.toLocaleDateString('en-US', { month: 'short' })})`
        });
    }

    return periods;
}

/**
 * Generate yearly periods (format: YYYY)
 */
function generateYearlyPeriods(count, referenceDate) {
    const periods = [];
    const year = referenceDate.getFullYear();

    for (let i = 0; i < count; i++) {
        const currentYear = year - i;
        periods.push({
            id: `${currentYear}`,
            name: `${currentYear}`
        });
    }

    return periods;
}

/**
 * Generate financial year periods
 * @param {number} startMonth - Starting month (0-based: 3=April, 6=July, etc.)
 */
function generateFinancialYearPeriods(count, referenceDate, startMonth) {
    const periods = [];
    const date = new Date(referenceDate);

    let year = date.getFullYear();
    if (date.getMonth() < startMonth) {
        year--; // Current FY started last year
    }

    for (let i = 0; i < count; i++) {
        const fyYear = year - i;
        const fyStart = new Date(fyYear, startMonth, 1);
        const fyEnd = new Date(fyYear + 1, startMonth, 0);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        periods.push({
            id: `${fyYear}${monthNames[startMonth]}`,
            name: `FY ${fyYear}/${String(fyYear + 1).slice(-2)} (${monthNames[startMonth]} ${fyYear} - ${monthNames[(startMonth - 1 + 12) % 12]} ${fyYear + 1})`
        });
    }

    return periods;
}

/**
 * Get ISO week number for a date
 */
function getWeekNumber(date, weekStartDay = 1) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 7 - weekStartDay) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

/**
 * Format date as short string (MMM DD)
 */
function formatShortDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Get period type display name
 */
export function getPeriodTypeDisplayName(periodType) {
    const displayNames = {
        'Daily': 'Daily',
        'Weekly': 'Weekly (Monday)',
        'WeeklyWednesday': 'Weekly (Wednesday)',
        'WeeklyThursday': 'Weekly (Thursday)',
        'WeeklySaturday': 'Weekly (Saturday)',
        'WeeklySunday': 'Weekly (Sunday)',
        'BiWeekly': 'Bi-weekly',
        'Monthly': 'Monthly',
        'BiMonthly': 'Bi-monthly',
        'Quarterly': 'Quarterly',
        'SixMonthly': 'Six-monthly',
        'SixMonthlyApril': 'Six-monthly (April)',
        'Yearly': 'Yearly',
        'FinancialApril': 'Financial Year (April)',
        'FinancialJuly': 'Financial Year (July)',
        'FinancialOct': 'Financial Year (October)',
        'FinancialNov': 'Financial Year (November)'
    };

    return displayNames[periodType] || periodType;
}

/**
 * Generate periods for current year
 */
export function generateYearPeriods(periodType) {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthsSinceYearStart = (now.getFullYear() - yearStart.getFullYear()) * 12 + (now.getMonth() - yearStart.getMonth()) + 1;

    switch (periodType) {
        case 'Monthly':
            return generatePeriods(periodType, monthsSinceYearStart, now);
        case 'Quarterly':
            return generatePeriods(periodType, Math.ceil(monthsSinceYearStart / 3), now);
        default:
            return generatePeriods(periodType, 12, now);
    }
}
