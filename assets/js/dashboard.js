/**
 * FinSight AI - Autonomous Dashboard Controller & ML Engine Simulation
 * Spark Theme Dashboard Implementation
 */

// Global State
let currentHorizon = 30; // 7, 14, 30 days
let topSellingDays = 30;
let topSellingChartInstance = null;
let slowMovingDays = 7;
let slowMovingChartInstance = null;

function getHorizonLabel(horizon = currentHorizon) {
    const days = Number(horizon);
    if (days === 1) return '24 Hours';
    return `${days} Days`;
}

function getProductImage(product) {
    const description = `${product.name || ''} ${product.category || ''}`.toLowerCase();
    const imageOptions = [
        [/watch|watches|timepiece/.test(description), 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=120&h=120&q=80'],
        [/pant|trouser|jean|denim/.test(description), 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=120&h=120&q=80'],
        [/shirt|t-shirt|tee|top|blouse/.test(description), 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=120&h=120&q=80'],
        [/shoe|sneaker|footwear/.test(description), 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=120&h=120&q=80'],
        [/phone|laptop|computer|electronics|gadget/.test(description), 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=120&h=120&q=80'],
        [/bag|backpack|purse/.test(description), 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=120&h=120&q=80']
    ];
    return imageOptions.find(([matches]) => matches)?.[1] || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=120&h=120&q=80';
}
let stockDemandChartInstance = null;
const stockDemand3dPlugin = {
    id: 'stockDemand3d',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const depth = 9;
        ctx.save();
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden) return;
            const palette = datasetIndex === 0
                ? { side: '#075985', top: '#7dd3fc' }
                : { side: '#5b21b6', top: '#c4b5fd' };
            meta.data.forEach(bar => {
                const { x, y, base, width } = bar.getProps(['x', 'y', 'base', 'width'], false);
                const left = x - width / 2;
                const right = x + width / 2;
                const top = Math.min(y, base);
                if (!Number.isFinite(left + right + top + base) || Math.abs(base - y) < 1) return;

                ctx.beginPath();
                ctx.moveTo(right, top);
                ctx.lineTo(right + depth, top - depth * 0.55);
                ctx.lineTo(right + depth, base - depth * 0.55);
                ctx.lineTo(right, base);
                ctx.closePath();
                ctx.fillStyle = palette.side;
                ctx.fill();

                ctx.beginPath();
                ctx.moveTo(left, top);
                ctx.lineTo(left + depth, top - depth * 0.55);
                ctx.lineTo(right + depth, top - depth * 0.55);
                ctx.lineTo(right, top);
                ctx.closePath();
                ctx.fillStyle = palette.top;
                ctx.fill();
            });
        });
        ctx.restore();
    }
};
let categoryChartInstance = null;
let selectedChartProductIds = [];
const MAX_CHART_PRODUCTS = 5;
let forecastTrendCharts = [];
let activeKpiFilter = 'all';
let activeExactProductId = null;

// India-wide holiday dates are refreshed annually. Lunar dates can vary by
// region or moon sighting; 2026 dates below follow the Government of India list.
const INDIA_EVENT_DATES = {
    2026: [
        ['2026-01-26', 'Republic Day', 'holiday'], ['2026-03-04', 'Holi', 'festival'],
        ['2026-03-21', 'Eid-ul-Fitr', 'festival'], ['2026-03-31', 'Mahavir Jayanti', 'holiday'],
        ['2026-04-03', 'Good Friday', 'holiday'], ['2026-05-01', 'Buddha Purnima', 'holiday'],
        ['2026-05-27', 'Eid-ul-Zuha', 'festival'], ['2026-06-26', 'Muharram', 'festival'],
        ['2026-08-15', 'Independence Day', 'holiday'], ['2026-08-26', 'Id-e-Milad', 'festival'],
        ['2026-09-04', 'Janmashtami', 'festival'], ['2026-10-02', 'Gandhi Jayanti', 'holiday'],
        ['2026-10-20', 'Dussehra', 'festival'], ['2026-11-08', 'Diwali', 'festival'],
        ['2026-11-24', 'Guru Nanak Jayanti', 'festival'], ['2026-12-25', 'Christmas', 'festival']
    ],
    2027: [
        ['2027-01-26', 'Republic Day', 'holiday'], ['2027-03-23', 'Holi', 'festival'],
        ['2027-08-15', 'Independence Day', 'holiday'], ['2027-10-09', 'Dussehra', 'festival'],
        ['2027-10-29', 'Diwali', 'festival'], ['2027-12-25', 'Christmas', 'festival']
    ]
};

const INDIA_SEASON_MONTHS = {
    summer: new Set([3, 4, 5, 6]),
    monsoon: new Set([7, 8, 9]),
    winter: new Set([11, 12, 1, 2])
};

const PRODUCT_CLIMATE_SIGNALS = {
    summer: /air conditioner|\bac\b|air cooler|cooler|\bfan\b|refrigerat|ice maker|sunscreen|sunglass|swim|beach|summer wear|cotton|cold drink|water bottle/i,
    winter: /heater|blanket|sweater|\bcoat\b|\bjacket\b|hoodie|thermal|wool|shawl|glove|muffler|room warmer|fleece/i,
    monsoon: /umbrella|raincoat|waterproof|rain boot|gumboot|windshield wiper|mosquito repellent/i
};

function getProductSeasonalSignals(product) {
    const description = `${product.name || ''} ${product.category || ''}`;
    const signals = Object.keys(PRODUCT_CLIMATE_SIGNALS).filter(season => PRODUCT_CLIMATE_SIGNALS[season].test(description));
    return signals;
}

function getEventDemandProfile(product, event) {
    const name = String(product.name || '').toLowerCase();
    const category = String(product.category || '').toLowerCase();
    const eventName = String(event.name || '').toLowerCase();
    const festiveItem = /gift|decoration|decor|string light|diya|sweet|firework|rakhi|festive|puja|dry fruit|gulal|pichkari|colour|color powder/i.test(name);
    const apparel = /shirt|pants|trouser|dress|saree|kurta|lehenga|blazer|jacket|sweater|hoodie|coat|shoe|apparel|garment|clothing/i.test(name);
    const electronics = /phone|laptop|headphone|earbud|earphone|keyboard|speaker|television|\btv\b|camera|charger|monitor|tablet|gaming|power bank|wh-1000/i.test(name);
    const toy = category === 'toys' || /toy|game|robot|doll|puzzle/i.test(name);
    const foodGift = /sweet|snack|dry fruit|chocolate|bakery|gift hamper|tea|coffee|gourmet|assorted/i.test(name);
    const homeDecor = /decoration|decor|string light|diya|lamp|lighting|puja/i.test(name);
    const holiGoods = /gulal|pichkari|water gun|colour|color powder|water balloon/i.test(name);
    const christmas = /christmas/.test(eventName);
    const holi = /holi/.test(eventName);
    const eid = /eid/.test(eventName);
    const shoppingFestival = /diwali|dussehra|navratri|durga|onam|pongal|janmashtami|guru nanak|mahavir/.test(eventName);

    if (holi) {
        if (holiGoods) return { uplift: 0.35, reason: 'Product name matches Holi colors or water-play goods.' };
        if (foodGift) return { uplift: 0.18, reason: 'Sweets and snack gifts are commonly purchased for Holi.' };
        if (apparel && /white|cotton|kurta|t-shirt|shirt/i.test(name)) return { uplift: 0.15, reason: 'Light cotton clothing is relevant to Holi celebrations.' };
        return { uplift: 0, reason: 'This product is not a clear match for Holi purchases.' };
    }
    if (christmas) {
        if (festiveItem || toy) return { uplift: 0.3, reason: 'Product type matches Christmas gifts, toys, or decorations.' };
        if (electronics || apparel) return { uplift: 0.16, reason: 'Electronics and clothing are common Christmas gifts.' };
        return { uplift: 0, reason: 'This product is not a clear match for Christmas purchases.' };
    }
    if (eid) {
        if (festiveItem || foodGift) return { uplift: 0.28, reason: 'Product type matches Eid gifts, sweets, or celebration goods.' };
        if (apparel) return { uplift: 0.24, reason: 'Clothing demand commonly rises ahead of Eid.' };
        return { uplift: 0, reason: 'This product is not a clear match for Eid purchases.' };
    }
    if (shoppingFestival) {
        if (festiveItem || homeDecor || foodGift) return { uplift: 0.3, reason: 'Product name matches festival gifts, decorations, or foods.' };
        if (apparel || electronics || toy) return { uplift: 0.2, reason: 'This product type is commonly included in festival shopping.' };
        return { uplift: 0, reason: 'This product is not a clear match for this festival.' };
    }
    return { uplift: 0, reason: 'No specific product match for this public holiday.' };
}

function getIndiaEventsForYear(year) {
    if (INDIA_EVENT_DATES[year]) return INDIA_EVENT_DATES[year].map(([date, name, type]) => ({ date, name, type }));
    // Approximate recurring shopping periods are used outside the maintained
    // calendar years; update exact lunar dates as each official calendar is published.
    return [
        [`${year}-01-26`, 'Republic Day', 'holiday'], [`${year}-03-15`, 'Holi season', 'festival'],
        [`${year}-08-15`, 'Independence Day', 'holiday'], [`${year}-09-10`, 'Onam/Ganesh festival season', 'festival'],
        [`${year}-10-20`, 'Dussehra/Diwali season', 'festival'], [`${year}-12-25`, 'Christmas', 'festival']
    ].map(([date, name, type]) => ({ date, name, type }));
}

function getDaySeasonalImpact(product, date) {
    const signals = getProductSeasonalSignals(product);
    const month = date.getMonth() + 1;
    let multiplier = 1;
    const reasons = [];
    for (const season of signals) {
        if (INDIA_SEASON_MONTHS[season].has(month)) {
            multiplier *= season === 'summer' ? 1.3 : season === 'winter' ? 1.3 : 1.25;
            reasons.push(`${season} demand`);
        } else {
            multiplier *= season === 'monsoon' ? 0.95 : 0.9;
            reasons.push(`off-season ${season} demand`);
        }
    }

    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const msPerDay = 24 * 60 * 60 * 1000;
    const nearbyEvents = getIndiaEventsForYear(date.getFullYear()).filter(event => {
        const eventDate = new Date(`${event.date}T00:00:00`);
        const daysFromEvent = Math.round((eventDate - today) / msPerDay);
        return daysFromEvent >= -2 && daysFromEvent <= 14;
    });
    nearbyEvents.forEach(event => {
        const eventDate = new Date(`${event.date}T00:00:00`);
        const daysToEvent = Math.round((eventDate - today) / msPerDay);
        const profile = getEventDemandProfile(product, event);
        const eventMultiplier = event.type === 'festival' ? 1 + profile.uplift : 1 + profile.uplift * 0.2;
        if (profile.uplift) reasons.push(`${event.name} buying period`);
        // Demand builds before the event; the event day and two following days
        // use the full lift, earlier days receive a smaller ramp-up.
        const ramp = daysToEvent > 2 ? 1 - Math.min(0.7, (daysToEvent - 2) / 20) : 1;
        multiplier *= 1 + (eventMultiplier - 1) * ramp;
    });
    return { multiplier: Math.max(0.1, Math.min(2.5, multiplier)), reasons: [...new Set(reasons)] };
}

function getUpcomingEventDemandPlans(daysAhead = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizonEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead);
    const events = [
        ...getIndiaEventsForYear(today.getFullYear()),
        ...getIndiaEventsForYear(today.getFullYear() + 1)
    ].map(event => ({ ...event, eventDate: new Date(`${event.date}T00:00:00`) }))
        .filter(event => event.eventDate >= today && event.eventDate <= horizonEnd)
        .sort((a, b) => a.eventDate - b.eventDate);

    return events.map(event => {
        event.daysUntil = Math.ceil((event.eventDate - today) / (24 * 60 * 60 * 1000));
        const products = productsData.map(product => {
            const profile = getEventDemandProfile(product, event);
            const eventUplift = profile.uplift * (event.type === 'festival' ? 1 : 0.2);
            if (!eventUplift) return null;
            let extraUnits = 0;
            for (let daysToEvent = Math.min(14, event.daysUntil); daysToEvent >= 0; daysToEvent -= 1) {
                const ramp = daysToEvent > 2 ? 1 - Math.min(0.7, (daysToEvent - 2) / 20) : 1;
                extraUnits += product.baseSalesDaily * eventUplift * ramp;
            }
            const baseUnitsUntilEvent = product.baseSalesDaily * (event.daysUntil + 1);
            const safetyBuffer = product.baseSalesDaily * Math.max(1, Number(product.leadDays) || 1) * 0.5;
            const stockGap = Math.max(0, Math.ceil(baseUnitsUntilEvent + extraUnits + safetyBuffer - product.stock));
            const prepareBy = new Date(event.eventDate);
            prepareBy.setDate(prepareBy.getDate() - 14 - Math.max(1, Number(product.leadDays) || 1));
            const prepareDays = Math.ceil((prepareBy - today) / (24 * 60 * 60 * 1000));
            return { product, profile, extraUnits: Math.round(extraUnits), stockGap, prepareBy, prepareDays };
        }).filter(item => item && item.extraUnits > 0)
            .sort((a, b) => Number(b.stockGap > 0) - Number(a.stockGap > 0) || b.extraUnits - a.extraUnits);
        return {
            ...event,
            products: products.slice(0, 6)
        };
    }).filter(event => event.products.length > 0);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function renderSeasonalDemandPlanner() {
    const container = document.getElementById('seasonal-event-list');
    if (!container) return;
    container.replaceChildren();
    const plans = getUpcomingEventDemandPlans();
    if (!plans.length) {
        container.innerHTML = '<div class="text-muted text-center py-5">No matching India holidays or festivals in the next 30 days.</div>';
        return;
    }

    const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    plans.forEach(event => {
        const card = document.createElement('div');
        card.className = 'seasonal-event-card mb-3';
        const productRows = event.products.length ? event.products.map(item => `
            <tr>
                <td><div class="fw-semibold">${escapeHtml(item.product.name)}</div><div class="small text-muted">${escapeHtml(item.product.sku)} · ${escapeHtml(item.product.category)}</div></td>
                <td class="text-end"><span class="fw-semibold text-success">+${item.extraUnits} units</span><div class="small text-muted">extra demand in the event run-up</div>${item.stockGap ? `<div class="small text-danger">Potential stock gap: ${item.stockGap} units</div>` : '<div class="small text-success">Current stock covers the estimate</div>'}</td>
                <td>${escapeHtml(item.profile.reason)}</td>
                <td class="text-nowrap">${item.stockGap ? (item.prepareDays <= 0 ? '<span class="text-danger fw-semibold">Add stock now</span>' : escapeHtml(dateFormat.format(item.prepareBy))) : '<span class="text-success">No order needed yet</span>'}<div class="small text-muted">${item.product.leadDays}-day supplier lead time + 14-day demand ramp</div></td>
            </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted py-3">No current products are strongly matched to this event.</td></tr>';
        card.innerHTML = `
            <div class="seasonal-event-heading">
                <div><div class="fw-semibold">${escapeHtml(event.name)}</div><div class="small text-muted">${escapeHtml(dateFormat.format(event.eventDate))} · ${event.daysUntil === 0 ? 'Today' : `in ${event.daysUntil} days`}</div></div>
                <span class="badge ${event.type === 'festival' ? 'bg-warning-subtle text-warning-emphasis' : 'bg-primary-subtle text-primary'}">${event.type === 'festival' ? 'Festival' : 'Holiday'}</span>
            </div>
            <div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Likely high-demand products</th><th class="text-end">Estimated extra demand & stock gap</th><th>Why demand may rise</th><th>Prepare stock by</th></tr></thead><tbody>${productRows}</tbody></table></div>`;
        container.appendChild(card);
    });

    const reminderBanner = document.getElementById('seasonal-reminder-banner');
    const reminderTitle = document.getElementById('seasonal-reminder-title');
    const reminderDescription = document.getElementById('seasonal-reminder-description');
    const reminders = plans.flatMap(event => event.products
        .filter(item => item.stockGap > 0 && item.prepareDays <= 30)
        .map(item => ({ ...item, event }))
    ).sort((a, b) => a.prepareDays - b.prepareDays);
    if (reminderBanner) reminderBanner.classList.toggle('d-none', reminders.length === 0);
    if (reminders.length && reminderTitle && reminderDescription) {
        const next = reminders[0];
        reminderTitle.textContent = `${reminders.length} product${reminders.length === 1 ? '' : 's'} may need seasonal stock soon`;
        reminderDescription.textContent = `${next.product.name} may need about ${next.stockGap} additional units for ${next.event.name}. ${next.prepareDays <= 0 ? 'The suggested order date has arrived.' : `Plan by ${dateFormat.format(next.prepareBy)}.`}`;
    }
}

function getHorizonSeasonalImpact(product, horizon) {
    const days = Math.max(1, Number(horizon) || 1);
    const today = new Date();
    let multiplierTotal = 0;
    const reasonDays = new Map();
    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        const impact = getDaySeasonalImpact(product, date);
        multiplierTotal += impact.multiplier;
        impact.reasons.forEach(reason => reasonDays.set(reason, (reasonDays.get(reason) || 0) + 1));
    }
    return {
        multiplier: multiplierTotal / days,
        reasons: [...reasonDays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([reason]) => reason)
    };
}

// Mock Products & ML Forecast Dataset
const demoProductsData = [
    {
        sku: 'SKU-ELEC-402',
        name: 'Ultra-Wide Curved Monitor 34"',
        category: 'Electronics',
        stock: 18,
        unitCost: 25000,
        supplier: 'Apex Electronics Ltd',
        leadDays: 10,
        baseSalesDaily: 2.1,
        // Factors for XAI
        factors: {
            salesTrend: 34,
            seasonality: 26,
            leadTime: 18,
            priceElasticity: 13,
            categoryMomentum: 9
        },
        narrative: "Demand velocity is accelerating (+24% MoM). Existing 18 units will deplete in 4 days, well within the 10-day supplier replenishment window. An autonomous reorder of 60 units is necessary to prevent ₹3.82L in lost revenue."
    },
    {
        sku: 'SKU-TECH-108',
        name: 'Ergonomic Mechanical Keyboard Pro',
        category: 'Accessories',
        stock: 24,
        unitCost: 4500,
        supplier: 'KeyMaster Peripherals',
        leadDays: 7,
        baseSalesDaily: 2.5,
        factors: {
            salesTrend: 38,
            seasonality: 20,
            leadTime: 22,
            priceElasticity: 12,
            categoryMomentum: 8
        },
        narrative: "High B2B bulk buy activity detected in Bengaluru tech zone. Stock will reach critical 0 in 5 days. Suggested PO of 65 units covers 30-day forecast plus 1.5x lead-time safety stock."
    },
    {
        sku: 'SKU-AUD-920',
        name: 'Sony WH-1000XM5 ANC Headset',
        category: 'Electronics',
        stock: 14,
        unitCost: 22000,
        supplier: 'Sonic Waves Distribution',
        leadDays: 8,
        baseSalesDaily: 1.7,
        factors: {
            salesTrend: 30,
            seasonality: 32,
            leadTime: 18,
            priceElasticity: 14,
            categoryMomentum: 6
        },
        narrative: "Festival sales momentum driven by upcoming quarterly corporate reward gifting. Depletion in 6 days. Recommended PO volume: 45 units (Outlay ₹9.9L)."
    },
    {
        sku: 'SKU-IOT-551',
        name: 'Smart Edge AI Sensor Hub',
        category: 'IoT',
        stock: 35,
        unitCost: 8500,
        supplier: 'IndoSensors Tech',
        leadDays: 12,
        baseSalesDaily: 3.0,
        factors: {
            salesTrend: 28,
            seasonality: 15,
            leadTime: 32,
            priceElasticity: 10,
            categoryMomentum: 15
        },
        narrative: "Supplier lead time is long (12 days). High burn rate requires triggering purchase order at 35 units to avoid stock rupture."
    },
    {
        sku: 'SKU-FURN-304',
        name: 'Pneumatic Height-Adjust Desk 140cm',
        category: 'Furniture',
        stock: 12,
        unitCost: 18000,
        supplier: 'ErgoCraft Workspaces',
        leadDays: 14,
        baseSalesDaily: 0.9,
        factors: {
            salesTrend: 31,
            seasonality: 18,
            leadTime: 29,
            priceElasticity: 14,
            categoryMomentum: 8
        },
        narrative: "Bulky fulfillment product with 14-day transit. Current 12 units will deplete in 9 days. Pre-emptive 22 units order recommended."
    },
    {
        sku: 'SKU-POW-601',
        name: 'GaN Fast Charger 140W Multi-Port',
        category: 'Accessories',
        stock: 65,
        unitCost: 2800,
        supplier: 'PowerVolt India',
        leadDays: 5,
        baseSalesDaily: 4.0,
        factors: {
            salesTrend: 35,
            seasonality: 25,
            leadTime: 15,
            priceElasticity: 15,
            categoryMomentum: 10
        },
        narrative: "Steady accessory attachment rate. Depletion expected in 16 days. High velocity replenishment scheduled."
    },
    {
        sku: 'SKU-DISP-772',
        name: '4K Conference Camera Bar with Mic',
        category: 'Electronics',
        stock: 42,
        unitCost: 32000,
        supplier: 'Apex Electronics Ltd',
        leadDays: 7,
        baseSalesDaily: 1.5,
        factors: {
            salesTrend: 25,
            seasonality: 20,
            leadTime: 20,
            priceElasticity: 20,
            categoryMomentum: 15
        },
        narrative: "Normal demand velocity. Current stock sufficient for 28 days. Safe reorder point."
    },
    {
        sku: 'SKU-SRV-209',
        name: 'Rackmount UPS 3000VA Smart-Online',
        category: 'IoT',
        stock: 28,
        unitCost: 45000,
        supplier: 'VoltaGuard Systems',
        leadDays: 10,
        baseSalesDaily: 0.7,
        factors: {
            salesTrend: 22,
            seasonality: 18,
            leadTime: 30,
            priceElasticity: 15,
            categoryMomentum: 15
        },
        narrative: "Healthy stock level. Over 40 days of inventory buffer active. No immediate purchase capital needed."
    }
];
let productsData = [];

// Purchase Orders Register State
const demoPurchaseOrders = [
    {
        id: 'PO-2026-0891',
        date: '2026-09-24',
        sku: 'SKU-ELEC-402',
        item: 'Ultra-Wide Curved Monitor 34"',
        qty: 60,
        supplier: 'Apex Electronics Ltd',
        leadTime: '10 Days',
        unitCost: 25000,
        total: 1500000,
        status: 'Approved' // Pending Approval, Approved, Received
    },
    {
        id: 'PO-2026-0890',
        date: '2026-09-23',
        sku: 'SKU-TECH-108',
        item: 'Ergonomic Mechanical Keyboard Pro',
        qty: 65,
        supplier: 'KeyMaster Peripherals',
        leadTime: '7 Days',
        unitCost: 4500,
        total: 292500,
        status: 'Pending Approval'
    },
    {
        id: 'PO-2026-0889',
        date: '2026-09-22',
        sku: 'SKU-AUD-920',
        item: 'Sony WH-1000XM5 ANC Headset',
        qty: 45,
        supplier: 'Sonic Waves Distribution',
        leadTime: '8 Days',
        unitCost: 22000,
        total: 990000,
        status: 'Pending Approval'
    },
    {
        id: 'PO-2026-0885',
        date: '2026-09-19',
        sku: 'SKU-POW-601',
        item: 'GaN Fast Charger 140W Multi-Port',
        qty: 100,
        supplier: 'PowerVolt India',
        leadTime: '5 Days',
        unitCost: 2800,
        total: 280000,
        status: 'Received'
    },
    {
        id: 'PO-2026-0882',
        date: '2026-09-17',
        sku: 'SKU-FURN-304',
        item: 'Pneumatic Height-Adjust Desk 140cm',
        qty: 25,
        supplier: 'ErgoCraft Workspaces',
        leadTime: '14 Days',
        unitCost: 18000,
        total: 450000,
        status: 'Approved'
    }
];
let purchaseOrders = [];

// Workforce Live Roster Dataset
const workforceData = [
    { name: 'Aarav Sharma', id: 'EMP-1042', branch: 'Mumbai Hub', role: 'Inventory Specialist', status: 'Active', attendance: 98, prod: 96 },
    { name: 'Priya Iyer', id: 'EMP-1088', branch: 'Bengaluru Hub', role: 'Fulfillment Lead', status: 'Active', attendance: 95, prod: 94 },
    { name: 'Rohan Deshmukh', id: 'EMP-1102', branch: 'Mumbai Hub', role: 'Warehouse Associate', status: 'On Leave', attendance: 88, prod: 89 },
    { name: 'Kavita Nair', id: 'EMP-1145', branch: 'Delhi NCR Hub', role: 'QC Inspector', status: 'Active', attendance: 99, prod: 97 },
    { name: 'Anish Kapoor', id: 'EMP-1190', branch: 'Bengaluru Hub', role: 'Shift Supervisor', status: 'Active', attendance: 92, prod: 91 },
    { name: 'Sunita Patel', id: 'EMP-1215', branch: 'Mumbai Hub', role: 'Sorting Tech', status: 'Absent', attendance: 82, prod: 80 },
    { name: 'Gaurav Sen', id: 'EMP-1234', branch: 'Delhi NCR Hub', role: 'Logistics Handler', status: 'Active', attendance: 94, prod: 93 },
    { name: 'Deepika Rao', id: 'EMP-1280', branch: 'Bengaluru Hub', role: 'Inbound Specialist', status: 'Active', attendance: 96, prod: 95 }
];

// Format INR Currency
function formatINR(number) {
    return '₹' + Number(number).toLocaleString('en-IN');
}

// Calculate dynamic demand based on Horizon
function getCalculatedMetrics(product, horizon) {
    // Multiplier for horizon
    const days = Number(horizon);
    // Predicted demand for horizon days
    const seasonalImpact = getHorizonSeasonalImpact(product, days);
    const currentImpact = getDaySeasonalImpact(product, new Date()).multiplier;
    const leadTimeImpact = getHorizonSeasonalImpact(product, product.leadDays).multiplier;
    const predictedDemand = Math.round(product.baseSalesDaily * days * seasonalImpact.multiplier);
    
    // Safety buffer based on lead time
    const safetyBuffer = Math.round(product.baseSalesDaily * leadTimeImpact * product.leadDays * 0.5);
    
    // Days of inventory left
    const daysLeft = Math.max(1, Math.round(product.stock / (product.baseSalesDaily * currentImpact)));
    
    // Stockout probability %
    let stockoutRisk = 0;
    if (daysLeft <= product.leadDays) {
        stockoutRisk = Math.min(96, Math.max(75, Math.round(100 - (daysLeft / product.leadDays) * 25)));
    } else if (daysLeft <= product.leadDays * 2) {
        stockoutRisk = Math.round(40 + (1 - (daysLeft - product.leadDays) / product.leadDays) * 30);
    } else {
        // Stock covers more than twice the supplier lead time, so it is not
        // currently at risk of stocking out before replenishment.
        stockoutRisk = 0;
    }

    // AI Recommended order
    let recommendedOrder = 0;
    if (product.stock < predictedDemand + safetyBuffer) {
        recommendedOrder = (predictedDemand + safetyBuffer) - product.stock;
        // round to neat pack
        recommendedOrder = Math.ceil(recommendedOrder / 5) * 5;
    }

    let priority = 'NORMAL';
    if (stockoutRisk >= 75) priority = 'CRITICAL';
    else if (stockoutRisk >= 50) priority = 'HIGH';

    return {
        predictedDemand,
        seasonalImpactPct: Math.round((seasonalImpact.multiplier - 1) * 100),
        seasonalReasons: seasonalImpact.reasons,
        safetyBuffer,
        daysLeft,
        stockoutRisk,
        recommendedOrder,
        priority,
        estimatedCost: recommendedOrder * product.unitCost
    };
}

function mapBusinessProduct(product) {
    return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        stock: product.stock,
        unitCost: product.unitCost,
        supplier: product.supplier,
        leadDays: product.leadDays,
        baseSalesDaily: product.baseSalesDaily,
        predicted7DayDemand: product.predicted7DayDemand,
        baselineSalesDaily: product.baselineSalesDaily,
        loggedSalesUnits: product.loggedSalesUnits || 0,
        salesHistoryDays: product.salesHistoryDays || 0,
        salesHistory: product.salesHistory || [],
        forecastSource: product.forecastSource,
        factors: product.factors,
        narrative: product.narrative
    };
}

// Load the signed-in user's business and products before rendering the dashboard.
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [profileResponse, productsResponse] = await Promise.all([
            fetch('/api/auth/me', { credentials: 'same-origin' }),
            fetch('/api/business/products', { credentials: 'same-origin' })
        ]);
        if (!profileResponse.ok || !productsResponse.ok) {
            window.location.replace('/');
            return;
        }
        const profile = (await profileResponse.json()).data;
        const result = (await productsResponse.json()).data;
        productsData = result.map(mapBusinessProduct);
        const displayName = profile.name || profile.email || 'User';
        const initials = displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        document.getElementById('dashboard-user-name').textContent = displayName;
        document.getElementById('dashboard-user-initials').textContent = initials;
        document.getElementById('dashboard-business-name').textContent = [profile.business_name, profile.business_category].filter(Boolean).join(' • ') || 'Business workspace';
        document.getElementById('authorized-user-name').textContent = displayName;
    } catch (error) {
        window.location.replace('/');
        return;
    }
    populateXAIProductOptions();
    initCharts();
    updateBusinessKpis();
    renderForecastTable();
    renderSeasonalDemandPlanner();
    renderReorderTable();
    renderAllProductAnalysis();
    renderSalesAndSlowMoving();
    renderPOTable();
    renderWorkforceRoster();
    setupEventListeners();
    if (productsData.length) updateXAIView(productsData[0]); // Start with the first saved product
    showSection('inventory-section'); // Show initial active section
    setupBusinessProductForm();
    setupCsvProductImport();
    setupRecordSaleForm();
    document.getElementById('logout-link')?.addEventListener('click', async (event) => {
        event.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.replace('/');
    });
});

function updateBusinessKpis() {
    const metrics = productsData.map(product => getCalculatedMetrics(product, 30));
    const lowStock = metrics.filter(item => item.priority === 'HIGH').length;
    const atRisk = metrics.filter(item => item.priority === 'CRITICAL').length;
    const overstocked = productsData.filter(product => product.stock > getCalculatedMetrics(product, 30).predictedDemand * 1.5).length;
    const values = {
        'kpi-total-skus': productsData.length,
        'kpi-low-stock': lowStock,
        'kpi-at-risk': atRisk,
        'kpi-overstocked': overstocked
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
    const segmentCount = document.getElementById('category-segment-count');
    if (segmentCount) segmentCount.textContent = `${new Set(productsData.map(product => product.category)).size} Segments`;
    const alertBanner = document.getElementById('urgent-alert-banner');
    const alertTitle = document.getElementById('urgent-alert-title');
    const alertDescription = document.getElementById('urgent-alert-description');
    if (alertBanner) alertBanner.classList.toggle('d-none', atRisk === 0);
    if (alertTitle) alertTitle.textContent = `Stockout warning: ${atRisk} product${atRisk === 1 ? '' : 's'} at high risk`;
    if (alertDescription) alertDescription.textContent = 'These products may run out before supplier replenishment. Review the recommended reorders.';
    renderNotificationAlerts();
}

function renderSalesAndSlowMoving() {
    const canvas = document.getElementById('top-selling-chart');
    const empty = document.getElementById('top-selling-empty');
    const tbody = document.getElementById('slow-moving-tbody');
    const slowEmpty = document.getElementById('slow-moving-empty');
    if (!canvas || !tbody) return;

    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const toDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const start = new Date(end);
    start.setDate(start.getDate() - topSellingDays + 1);
    start.setHours(0, 0, 0, 0);
    const periodSales = product => (product.salesHistory || []).reduce((total, sale) => {
        const date = new Date(`${sale.date}T00:00:00`);
        return date >= start && date <= end ? total + (Number(sale.quantity) || 0) : total;
    }, 0);
    const leaders = productsData.map(product => ({ product, units: periodSales(product) }))
        .filter(item => item.units > 0)
        .sort((a, b) => b.units - a.units || a.product.name.localeCompare(b.product.name))
        .slice(0, 5);

    if (empty) empty.hidden = leaders.length > 0;
    if (topSellingChartInstance) topSellingChartInstance.destroy();
    topSellingChartInstance = null;
    if (leaders.length) {
        const dateKeys = Array.from({ length: topSellingDays }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return toDateKey(date);
        });
        topSellingChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: dateKeys.map(key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                datasets: leaders.map((item, index) => {
                    const salesByDate = new Map((item.product.salesHistory || []).map(sale => [sale.date, Number(sale.quantity) || 0]));
                    const color = ['#6366f1', '#0891b2', '#16a34a', '#f59e0b', '#ec4899'][index];
                    return { label: item.product.name, data: dateKeys.map(key => salesByDate.get(key) || 0), borderColor: color, backgroundColor: color, tension: 0.3, pointRadius: topSellingDays === 1 ? 4 : 2, pointHoverRadius: 5, fill: false };
                })
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${context.raw} units` } } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0f5' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } }
            }
        });
    }

    const weekStart = new Date(end);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const slowMovers = productsData.filter(product => Number(product.stock) > 0).map(product => {
        const sold = (product.salesHistory || []).reduce((total, sale) => {
            const date = new Date(`${sale.date}T00:00:00`);
            return date >= weekStart && date <= end ? total + (Number(sale.quantity) || 0) : total;
        }, 0);
        const openingStockEstimate = Number(product.stock) + sold;
        return { product, sold, sellThrough: openingStockEstimate > 0 ? sold / openingStockEstimate : 0 };
    }).filter(item => item.sellThrough <= 0.25)
        .sort((a, b) => a.sellThrough - b.sellThrough || b.product.stock - a.product.stock);

    const slowCanvas = document.getElementById('slow-moving-chart');
    const slowChartEmpty = document.getElementById('slow-moving-chart-empty');
    if (slowMovingChartInstance) slowMovingChartInstance.destroy();
    slowMovingChartInstance = null;
    if (slowCanvas && slowMovers.length) {
        const slowStart = new Date(end);
        slowStart.setDate(slowStart.getDate() - slowMovingDays + 1);
        slowStart.setHours(0, 0, 0, 0);
        const slowDateKeys = Array.from({ length: slowMovingDays }, (_, index) => {
            const date = new Date(slowStart);
            date.setDate(slowStart.getDate() + index);
            return toDateKey(date);
        });
        const colors = ['#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#22c55e'];
        slowMovingChartInstance = new Chart(slowCanvas, {
            type: 'line',
            data: {
                labels: slowDateKeys.map(key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
                datasets: slowMovers.slice(0, 5).map(({ product }, index) => {
                    const salesByDate = new Map((product.salesHistory || []).map(sale => [sale.date, Number(sale.quantity) || 0]));
                    return { label: product.name, data: slowDateKeys.map(key => salesByDate.get(key) || 0), borderColor: colors[index], backgroundColor: colors[index], tension: 0.3, pointRadius: 2, fill: false };
                })
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, usePointStyle: true, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } } }
        });
    }
    if (slowChartEmpty) slowChartEmpty.hidden = slowMovers.length > 0;
    tbody.replaceChildren();
    slowMovers.slice(0, 5).forEach(({ product, sold }) => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.className = 'fw-medium';
        name.textContent = product.name;
        const stock = document.createElement('td');
        stock.className = 'text-end';
        stock.textContent = Number(product.stock).toLocaleString();
        const cover = document.createElement('td');
        cover.className = 'text-end fw-semibold text-warning-emphasis';
        const weekOpeningStock = Number(product.stock) + sold;
        cover.textContent = `${sold} / ${weekOpeningStock.toLocaleString()} (${Math.round(sold / weekOpeningStock * 100)}%)`;
        row.append(name, stock, cover);
        tbody.append(row);
    });
    if (slowEmpty) slowEmpty.hidden = slowMovers.length > 0;
}

function renderNotificationAlerts() {
    const list = document.getElementById('notification-list');
    const emptyMessage = document.getElementById('notification-empty');
    const countBadge = document.getElementById('notification-count');
    if (!list || !emptyMessage || !countBadge) return;

    const alerts = productsData
        .map(product => ({ product, metrics: getCalculatedMetrics(product, 30) }))
        .filter(({ metrics }) => metrics.priority === 'CRITICAL' || metrics.priority === 'HIGH')
        .sort((a, b) => b.metrics.stockoutRisk - a.metrics.stockoutRisk);

    list.replaceChildren();
    alerts.forEach(({ product, metrics }) => {
        const link = document.createElement('a');
        link.className = 'dropdown-item rounded p-2';
        link.href = '#reorder-section';
        link.addEventListener('click', event => {
            event.preventDefault();
            showSection('reorder-section');
        });

        const row = document.createElement('div');
        row.className = 'd-flex align-items-start';
        const severity = document.createElement('span');
        severity.className = metrics.priority === 'CRITICAL'
            ? 'badge bg-danger-subtle text-danger me-2 mt-1'
            : 'badge bg-warning-subtle text-warning me-2 mt-1';
        severity.textContent = metrics.priority;

        const details = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'fw-semibold small';
        name.textContent = product.name;
        const summary = document.createElement('div');
        summary.className = 'text-muted';
        summary.style.fontSize = '0.72rem';
        summary.textContent = `${product.stock} units left • Stockout in ${metrics.daysLeft} days`;
        details.append(name, summary);
        row.append(severity, details);
        link.append(row);
        list.append(link);
    });

    countBadge.textContent = alerts.length;
    countBadge.classList.toggle('d-none', alerts.length === 0);
    emptyMessage.classList.toggle('d-none', alerts.length > 0);
}

function populateXAIProductOptions() {
    const select = document.getElementById('xai-stock-select');
    const detail = document.getElementById('xai-product-detail');
    if (!select) return;

    select.replaceChildren();
    if (!productsData.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No products added yet';
        select.append(option);
        if (detail) detail.classList.add('d-none');
        return;
    }

    productsData.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = product.name;
        select.append(option);
    });
    select.value = productsData[0].id;
    if (detail) detail.classList.remove('d-none');
}

function renderAllProductAnalysis() {
    const tbody = document.getElementById('xai-overview-tbody');
    const emptyMessage = document.getElementById('xai-overview-empty');
    if (!tbody || !emptyMessage) return;

    tbody.replaceChildren();
    emptyMessage.classList.toggle('d-none', productsData.length > 0);

    productsData.forEach(product => {
        const metrics = getCalculatedMetrics(product, 30);
        const row = document.createElement('tr');
        const productCell = document.createElement('td');
        const name = document.createElement('div');
        name.className = 'fw-semibold text-dark';
        name.textContent = product.name;
        const identity = document.createElement('div');
        identity.className = 'text-muted small';
        identity.textContent = `${product.sku} · ${product.category}`;
        productCell.append(name, identity);

        const stockCell = document.createElement('td');
        stockCell.className = 'text-center fw-semibold';
        stockCell.textContent = `${product.stock} units`;
        const demandCell = document.createElement('td');
        demandCell.className = 'text-center';
        demandCell.textContent = `${metrics.predictedDemand} units`;
        const coverageCell = document.createElement('td');
        coverageCell.className = 'text-center';
        coverageCell.textContent = `${metrics.daysLeft} days`;

        const riskCell = document.createElement('td');
        riskCell.className = 'text-center';
        const riskBadge = document.createElement('span');
        const badgeClass = metrics.priority === 'CRITICAL' ? 'badge-critical'
            : metrics.priority === 'HIGH' ? 'badge-warning' : 'badge-normal';
        riskBadge.className = `badge-pill-custom ${badgeClass}`;
        riskBadge.textContent = `${metrics.stockoutRisk}% ${metrics.priority}`;
        riskCell.append(riskBadge);

        const orderCell = document.createElement('td');
        orderCell.className = 'text-center';
        orderCell.textContent = metrics.recommendedOrder > 0 ? `${metrics.recommendedOrder} units` : '—';
        const analysisCell = document.createElement('td');
        analysisCell.className = 'small text-muted';
        analysisCell.textContent = metrics.priority === 'CRITICAL'
            ? `Stockout in about ${metrics.daysLeft} days, before the ${product.leadDays}-day lead time.`
            : metrics.priority === 'HIGH'
                ? `Coverage is approaching the ${product.leadDays}-day supplier lead time.`
                : 'Current stock covers the supplier lead-time window.';

        row.append(productCell, stockCell, demandCell, coverageCell, riskCell, orderCell, analysisCell);
        tbody.append(row);
    });
}

function setupBusinessProductForm() {
    const form = document.getElementById('dashboard-product-form');
    const errorBox = document.getElementById('dashboard-product-error');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.textContent = '';
        errorBox.classList.add('d-none');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        const skuField = form.querySelector('[name="sku"]');
        if (skuField && !skuField.value) skuField.value = 'CUSTOM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const fields = new FormData(form);
        try {
            const response = await fetch('/api/business/products', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(fields.entries()))
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Could not save product.');
            window.location.reload();
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.classList.remove('d-none');
            button.disabled = false;
        }
    });
}

function setupRecordSaleForm() {
    const form = document.getElementById('record-sale-form');
    const tbody = document.getElementById('forecast-tbody');
    const modalElement = document.getElementById('record-sale-modal');
    if (!form || !tbody || !modalElement) return;

    tbody.addEventListener('click', event => {
        const button = event.target.closest('.record-sale-btn');
        if (!button) return;
        const product = productsData.find(item => String(item.id) === String(button.dataset.productId));
        if (!product) return;
        document.getElementById('record-sale-product-id').value = product.id;
        document.getElementById('record-sale-product-label').textContent = `${product.name} (${product.sku})`;
        document.getElementById('record-sale-stock-note').textContent = `${product.stock} units currently in stock. Recording a sale updates stock and the demand forecast.`;
        const quantity = document.getElementById('record-sale-quantity');
        quantity.max = product.stock;
        quantity.value = product.stock > 0 ? 1 : '';
        quantity.disabled = product.stock < 1;
        form.querySelector('button[type="submit"]').disabled = product.stock < 1;
        const error = document.getElementById('record-sale-error');
        error.textContent = product.stock > 0 ? '' : 'There is no stock available to record a sale.';
        error.classList.toggle('d-none', product.stock > 0);
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const productId = document.getElementById('record-sale-product-id').value;
        const quantity = Number(document.getElementById('record-sale-quantity').value);
        const error = document.getElementById('record-sale-error');
        const button = form.querySelector('button[type="submit"]');
        error.textContent = '';
        error.classList.add('d-none');
        button.disabled = true;
        try {
            const response = await fetch(`/api/business/products/${encodeURIComponent(productId)}/sales`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity })
            });
            const responseBody = await response.text();
            let result;
            try {
                result = JSON.parse(responseBody);
            } catch {
                throw new Error(`Backend returned HTTP ${response.status} without a JSON response. Restart the Flask backend and try again.`);
            }
            if (!response.ok) throw new Error(result.message || 'Could not record this sale.');
            const updatedProduct = mapBusinessProduct(result.data);
            const productIndex = productsData.findIndex(product => String(product.id) === String(updatedProduct.id));
            if (productIndex >= 0) {
                const previousProduct = productsData[productIndex];
                const today = new Date().toISOString().slice(0, 10);
                if (!(updatedProduct.salesHistory || []).some(sale => sale.date === today)) {
                    const previousTodaySales = (previousProduct.salesHistory || [])
                        .filter(sale => sale.date === today)
                        .reduce((total, sale) => total + (Number(sale.quantity) || 0), 0);
                    updatedProduct.salesHistory = [
                        ...(previousProduct.salesHistory || []).filter(sale => sale.date !== today),
                        { date: today, quantity: previousTodaySales + quantity }
                    ];
                }
                productsData[productIndex] = updatedProduct;
            }

            updateBusinessKpis();
            renderForecastTable();
            renderReorderTable();
            renderAllProductAnalysis();
            renderNotificationAlerts();
            renderSeasonalDemandPlanner();
            updateChartData();
            if (document.getElementById('xai-stock-select')?.value === updatedProduct.id) {
                updateXAIView(updatedProduct);
            }
            bootstrap.Modal.getOrCreateInstance(modalElement).hide();
            form.reset();
            showToast(`Recorded ${quantity} sale${quantity === 1 ? '' : 's'} for ${updatedProduct.name}. Graphs updated.`);
        } catch (requestError) {
            error.textContent = requestError.message;
            error.classList.remove('d-none');
            button.disabled = false;
        }
    });
}

// SPA Section Switching: Only show clicked section
function showSection(sectionId) {
    if (!sectionId) return;
    sectionId = sectionId.replace('#', '');

    // Hide all sections
    const sections = document.querySelectorAll('.app-section');
    sections.forEach(sec => {
        sec.classList.remove('active');
        sec.style.display = 'none';
    });

    // Show target section
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block';
    }

    // Update active class on sidebar navigation
    const navLinks = document.querySelectorAll('.sidebar-menu .nav-link');
    navLinks.forEach(link => {
        const href = link.getAttribute('href')?.replace('#', '');
        if (href === sectionId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Update top header title / breadcrumb
    const titles = {
        'inventory-section': '📦 Inventory Intelligence Overview',
        'forecast-section': '📈 AI Product Demand Forecast Matrix',
        'seasonal-section': '📅 Seasonal Demand Planner',
        'xai-section': '🔍 Explainable AI (XAI) Factor Analysis',
        'reorder-section': '⚡ Autonomous AI Reorder Engine & Recommendations',
        'po-section': '📝 Purchase Order (PO) Management Register',
        'workforce-section': '🏢 Module 1: Workforce Intelligence & Predictive Staffing',
        'settings-section': '⚙️ Engine Rules & ERP Data Synchronization'
    };
    const titleEl = document.getElementById('top-section-title');
    if (titleEl && titles[sectionId]) {
        titleEl.textContent = titles[sectionId];
    }

    // On mobile close sidebar if opened
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 992 && sidebar && sidebar.classList.contains('show')) {
        sidebar.classList.remove('show');
    }

    // Resize Chart.js if inventory section
    if (sectionId === 'inventory-section') {
        setTimeout(() => {
            if (stockDemandChartInstance) stockDemandChartInstance.resize();
            if (categoryChartInstance) categoryChartInstance.resize();
        }, 50);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Setup All Interactive Event Listeners
function setupEventListeners() {
    document.querySelectorAll('#slow-moving-period [data-slow-days]').forEach(button => {
        button.addEventListener('click', () => {
            slowMovingDays = Number(button.dataset.slowDays);
            document.querySelectorAll('#slow-moving-period [data-slow-days]').forEach(item => {
                const selected = item === button;
                item.classList.toggle('btn-primary', selected);
                item.classList.toggle('active', selected);
                item.classList.toggle('btn-outline-primary', !selected);
                item.setAttribute('aria-pressed', String(selected));
            });
            renderSalesAndSlowMoving();
        });
    });
    document.querySelectorAll('#top-selling-period [data-sales-days]').forEach(button => {
        button.addEventListener('click', () => {
            topSellingDays = Number(button.dataset.salesDays);
            document.querySelectorAll('#top-selling-period [data-sales-days]').forEach(item => {
                const selected = item === button;
                item.classList.toggle('btn-primary', selected);
                item.classList.toggle('active', selected);
                item.classList.toggle('btn-outline-primary', !selected);
                item.setAttribute('aria-pressed', String(selected));
            });
            renderSalesAndSlowMoving();
        });
    });
    document.querySelectorAll('[data-kpi-filter]').forEach(card => {
        const activate = () => filterByKpi(card.dataset.kpiFilter);
        card.addEventListener('click', activate);
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });
    });
    document.getElementById('clear-kpi-filter')?.addEventListener('click', () => filterByKpi('all'));

    // Mobile sidebar toggle
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('show');
        });
    }

    // Horizon Selector Buttons
    const horizonBtns = document.querySelectorAll('#horizon-selector button');
    horizonBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            horizonBtns.forEach(b => {
                b.classList.remove('btn-primary', 'active');
                b.classList.add('btn-outline-primary');
            });
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-primary', 'active');
            
            currentHorizon = parseInt(btn.getAttribute('data-horizon'));
            renderForecastTable();
            renderReorderTable();
            updateChartData();
            showToast(`Forecast horizon set to ${getHorizonLabel()}. ML calculations updated.`);
        });
    });

    // Search and Category filters for Forecast
    const forecastSearch = document.getElementById('forecast-search');
    const categoryFilter = document.getElementById('category-filter');
    if (forecastSearch) forecastSearch.addEventListener('input', renderForecastTable);
    if (categoryFilter) categoryFilter.addEventListener('change', renderForecastTable);

    // Global Search Filter
    const globalSearch = document.getElementById('global-search-input');
    if (globalSearch) {
        globalSearch.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            activeKpiFilter = 'all';
            activeExactProductId = null;
            document.getElementById('kpi-filter-summary')?.classList.add('d-none');
            if (categoryFilter) categoryFilter.value = 'all';
            renderGlobalProductSearch(query);
            if (forecastSearch) forecastSearch.value = query.toLowerCase();
            renderForecastTable();
        });
        globalSearch.addEventListener('keydown', event => {
            if (event.key === 'Escape') hideGlobalProductSearch();
            if (event.key === 'Enter') {
                const firstResult = document.querySelector('#global-search-results [data-product-id]');
                if (firstResult) {
                    event.preventDefault();
                    openGlobalSearchProduct(firstResult.dataset.productId);
                } else if (globalSearch.value.trim()) {
                    activeKpiFilter = 'all';
                    activeExactProductId = null;
                    document.getElementById('kpi-filter-summary')?.classList.add('d-none');
                    const categoryFilter = document.getElementById('category-filter');
                    if (categoryFilter) categoryFilter.value = 'all';
                    showSection('forecast-section');
                    renderForecastTable();
                    hideGlobalProductSearch();
                }
            }
        });
    }
    document.addEventListener('click', event => {
        if (!event.target.closest('.search-box')) hideGlobalProductSearch();
    });

    // PO Status Filter
    const poFilterBtns = document.querySelectorAll('#po-status-filter button');
    poFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            poFilterBtns.forEach(b => b.classList.remove('active', 'btn-secondary'));
            poFilterBtns.forEach(b => b.classList.add('btn-outline-secondary'));
            btn.classList.remove('btn-outline-secondary');
            btn.classList.add('btn-secondary', 'active');
            renderPOTable(btn.getAttribute('data-status'));
        });
    });

    // Batch Approve Button
    const batchBtn = document.getElementById('batch-approve-btn');
    if (batchBtn) {
        batchBtn.addEventListener('click', batchApproveCriticalOrders);
    }

    // XAI Quick Order Button
    const xaiOrderBtn = document.getElementById('xai-order-btn');
    if (xaiOrderBtn) {
        xaiOrderBtn.addEventListener('click', () => {
            const currentProductId = document.getElementById('xai-stock-select')?.value;
            const product = productsData.find(p => p.id === currentProductId);
            if (product) {
                createPOFromProduct(product.id);
            }
        });
    }

    // Roster Search
    const rosterSearch = document.getElementById('roster-search');
    if (rosterSearch) {
        rosterSearch.addEventListener('input', renderWorkforceRoster);
    }

    // Branch filter update
    const branchFilter = document.getElementById('branch-filter');
    if (branchFilter) {
        branchFilter.addEventListener('change', (e) => {
            showToast(`Filtered metrics for: ${e.target.options[e.target.selectedIndex].text}`);
        });
    }

    // Mode Switcher Button
    const modeSwitchBtn = document.getElementById('mode-switch-btn');
    if (modeSwitchBtn) {
        modeSwitchBtn.addEventListener('click', () => {
            alert("Personal mode is unavailable. Please select Business Intelligence.");
        });
    }
}

function filterByKpi(filter) {
    activeKpiFilter = filter || 'all';
    activeExactProductId = null;
    const labels = {
        all: 'Showing all active products',
        'low-stock': 'Showing products with a high stock alert',
        critical: 'Showing products at imminent stockout risk',
        overstocked: 'Showing overstocked products'
    };
    const summary = document.getElementById('kpi-filter-summary');
    const summaryText = document.getElementById('kpi-filter-summary-text');
    const search = document.getElementById('forecast-search');
    const category = document.getElementById('category-filter');
    const globalSearch = document.getElementById('global-search-input');

    if (activeKpiFilter === 'reorder-capital') {
        showSection('reorder-section');
        renderReorderTable();
        return;
    }

    if (search) search.value = '';
    if (globalSearch) globalSearch.value = '';
    if (category) category.value = 'all';
    if (summaryText) summaryText.textContent = labels[activeKpiFilter] || labels.all;
    summary?.classList.toggle('d-none', activeKpiFilter === 'all');
    showSection('forecast-section');
    renderForecastTable();
}

function renderGlobalProductSearch(query) {
    const results = document.getElementById('global-search-results');
    const input = document.getElementById('global-search-input');
    if (!results || !input) return;
    results.replaceChildren();
    if (!query) {
        hideGlobalProductSearch();
        return;
    }

    const normalized = query.toLocaleLowerCase();
    const matches = productsData.filter(product =>
        [product.name, product.sku, product.category].some(value => String(value || '').toLocaleLowerCase().includes(normalized))
    );
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'global-search-empty';
        empty.textContent = 'No matching products in your inventory.';
        results.appendChild(empty);
    } else {
        matches.slice(0, 8).forEach(product => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'global-search-result';
            button.setAttribute('role', 'option');
            button.dataset.productId = product.id;
            const name = document.createElement('span');
            name.className = 'd-block fw-semibold';
            name.textContent = product.name;
            const details = document.createElement('span');
            details.className = 'd-block small text-muted';
            details.textContent = `${product.sku} · ${product.category} · ${product.stock} units`;
            button.append(name, details);
            button.addEventListener('click', () => openGlobalSearchProduct(product.id));
            results.appendChild(button);
        });
        if (matches.length > 8) {
            const more = document.createElement('div');
            more.className = 'global-search-empty';
            more.textContent = `Showing 8 of ${matches.length} matches. Refine your search.`;
            results.appendChild(more);
        }
    }
    results.classList.remove('d-none');
    input.setAttribute('aria-expanded', 'true');
}

function hideGlobalProductSearch() {
    document.getElementById('global-search-results')?.classList.add('d-none');
    document.getElementById('global-search-input')?.setAttribute('aria-expanded', 'false');
}

function openGlobalSearchProduct(productId) {
    const product = productsData.find(item => String(item.id) === String(productId));
    if (!product) return;
    activeKpiFilter = 'all';
    activeExactProductId = product.id;
    document.getElementById('kpi-filter-summary')?.classList.add('d-none');
    const categoryFilter = document.getElementById('category-filter');
    const forecastSearch = document.getElementById('forecast-search');
    if (categoryFilter) categoryFilter.value = 'all';
    if (forecastSearch) forecastSearch.value = product.name;
    showSection('forecast-section');
    renderForecastTable();
    hideGlobalProductSearch();
}

const categoryChartColors = ['#6366f1', '#06b6d4', '#f59e0b', '#f43f5e', '#22c55e', '#d946ef', '#8b5cf6', '#14b8a6'];
const singleCategoryGradient = 'linear-gradient(135deg, #6366f1, #06b6d4, #22c55e, #f59e0b, #f43f5e, #d946ef, #6366f1)';

function createSingleCategoryCanvasGradient(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea || !ctx.createConicGradient) return categoryChartColors[0];
    const gradient = ctx.createConicGradient(
        -Math.PI / 2,
        (chartArea.left + chartArea.right) / 2,
        (chartArea.top + chartArea.bottom) / 2
    );
    gradient.addColorStop(0, '#6366f1');
    gradient.addColorStop(0.18, '#06b6d4');
    gradient.addColorStop(0.36, '#22c55e');
    gradient.addColorStop(0.54, '#f59e0b');
    gradient.addColorStop(0.72, '#f43f5e');
    gradient.addColorStop(0.9, '#d946ef');
    gradient.addColorStop(1, '#6366f1');
    return gradient;
}

function setupCsvProductImport() {
    const panel = document.getElementById('csv-import-panel');
    const toggle = document.getElementById('toggle-csv-import');
    const fileInput = document.getElementById('products-csv-file');
    const importButton = document.getElementById('import-products-csv');
    const status = document.getElementById('csv-import-status');
    if (!panel || !toggle || !fileInput || !importButton || !status) return;

    let parsedProducts = null;
    const columns = ['name', 'sku', 'category', 'stock', 'price', 'daily_sales', 'lead_days'];
    const parseCsv = (text) => {
        const rows = [];
        let row = [], cell = '', quoted = false;
        text = text.replace(/^\uFEFF/, '');
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (quoted) {
                if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
                else if (char === '"') quoted = false;
                else cell += char;
            } else if (char === '"' && cell === '') quoted = true;
            else if (char === ',') { row.push(cell.trim()); cell = ''; }
            else if (char === '\n' || char === '\r') {
                if (char === '\r' && text[i + 1] === '\n') i++;
                row.push(cell.trim()); cell = '';
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
            } else cell += char;
        }
        if (quoted) throw new Error('The CSV has an unclosed quoted field.');
        row.push(cell.trim());
        if (row.some(value => value !== '')) rows.push(row);
        if (rows.length < 2) throw new Error('The CSV must include a header and at least one product row.');
        const headers = rows.shift().map(value => value.toLowerCase());
        if (columns.some(column => !headers.includes(column))) {
            throw new Error(`Required columns: ${columns.join(', ')}.`);
        }
        return rows.map((values, index) => {
            const item = Object.fromEntries(columns.map(column => [column, values[headers.indexOf(column)] || '']));
            item.stock = Number(item.stock);
            item.price = Number(item.price);
            item.daily_sales = Number(item.daily_sales);
            item.lead_days = Number(item.lead_days || 7);
            if (!item.name || !item.sku || !item.category || !Number.isInteger(item.stock) || item.stock < 0 ||
                !Number.isFinite(item.price) || item.price <= 0 || !Number.isFinite(item.daily_sales) || item.daily_sales <= 0 ||
                !Number.isInteger(item.lead_days) || item.lead_days < 1) {
                throw new Error(`Invalid values on CSV row ${index + 2}. Check name, SKU, category, stock, price, daily_sales, and lead_days.`);
            }
            return item;
        });
    };

    toggle.addEventListener('click', () => {
        panel.classList.toggle('d-none');
        toggle.setAttribute('aria-expanded', String(!panel.classList.contains('d-none')));
    });
    fileInput.addEventListener('change', async () => {
        parsedProducts = null;
        importButton.disabled = true;
        status.className = 'small mt-2';
        if (!fileInput.files[0]) { status.textContent = ''; return; }
        try {
            parsedProducts = parseCsv(await fileInput.files[0].text());
            status.textContent = `${parsedProducts.length} product${parsedProducts.length === 1 ? '' : 's'} ready to import.`;
            importButton.disabled = false;
        } catch (error) {
            status.classList.add('text-danger');
            status.textContent = error.message;
        }
    });
    importButton.addEventListener('click', async () => {
        if (!parsedProducts) return;
        importButton.disabled = true;
        fileInput.disabled = true;
        let imported = 0;
        const failures = [];
        for (const [index, product] of parsedProducts.entries()) {
            try {
                const response = await fetch('/api/business/products', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(product)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
                imported++;
            } catch (error) {
                failures.push(`CSV row ${index + 2}: ${error.message}`);
            }
            status.textContent = `Imported ${imported} of ${parsedProducts.length}…`;
        }
        status.className = `small mt-2 ${failures.length ? 'text-danger' : 'text-success'}`;
        status.textContent = failures.length
            ? `Imported ${imported} of ${parsedProducts.length}. ${failures.slice(0, 5).join(' ')}${failures.length > 5 ? ` And ${failures.length - 5} more failed rows.` : ''}`
            : `Successfully imported ${imported} products.`;
        fileInput.disabled = false;
        importButton.disabled = true;
        if (imported) setTimeout(() => window.location.reload(), failures.length ? 3500 : 1200);
    });
}

function getCategoryBreakdown(horizon = currentHorizon) {
    const totals = new Map();
    productsData.forEach(product => {
        const metrics = getCalculatedMetrics(product, horizon);
        const category = product.category || 'Uncategorized';
        const current = totals.get(category) || { category, demand: 0, reorderValue: 0 };
        current.demand += metrics.predictedDemand;
        current.reorderValue += metrics.estimatedCost;
        totals.set(category, current);
    });
    return [...totals.values()].sort((a, b) => b.demand - a.demand);
}

function formatCompactINR(amount) {
    const value = Number(amount) || 0;
    if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`;
    if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
    if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
    return formatINR(value);
}

function renderCategoryDemandLegend(breakdown) {
    const container = document.getElementById('category-demand-legend');
    const title = document.getElementById('category-chart-title');
    const segmentCount = document.getElementById('category-segment-count');
    if (!container) return;

    container.replaceChildren();
    const totalDemand = breakdown.reduce((sum, item) => sum + item.demand, 0);
    if (title) title.textContent = `${getHorizonLabel()} Category Demand Share`;
    if (segmentCount) segmentCount.textContent = `${breakdown.length} Segment${breakdown.length === 1 ? '' : 's'}`;
    if (!breakdown.length) {
        const empty = document.createElement('div');
        empty.className = 'small text-muted text-center py-2';
        empty.textContent = 'Add products to see category demand and suggested order values.';
        container.append(empty);
        return;
    }

    breakdown.forEach((item, index) => {
        const share = totalDemand ? Math.round(item.demand / totalDemand * 100) : 0;
        const row = document.createElement('div');
        row.className = 'd-flex justify-content-between small text-muted mb-1';
        row.style.fontSize = '0.75rem';
        const label = document.createElement('span');
        const dot = document.createElement('span');
        dot.className = 'category-color-dot me-1';
        dot.style.background = breakdown.length === 1
            ? singleCategoryGradient
            : categoryChartColors[index % categoryChartColors.length];
        label.append(dot, document.createTextNode(`${item.category} (${share}%)`));
        const amount = document.createElement('span');
        amount.className = 'fw-semibold text-dark';
        amount.textContent = `${formatCompactINR(item.reorderValue)} Suggested`;
        row.append(label, amount);
        container.append(row);
    });
}

// Initialize Charts using Chart.js
function getChartProducts() {
    if (productsData.length <= MAX_CHART_PRODUCTS) return productsData;
    return productsData.filter(product => selectedChartProductIds.includes(String(product.id)));
}

function renderStockDemandProductPicker() {
    const picker = document.getElementById('chart-product-picker');
    const options = document.getElementById('chart-product-options');
    const label = document.getElementById('chart-product-picker-label');
    if (!picker || !options || !label) return;

    picker.hidden = productsData.length <= MAX_CHART_PRODUCTS;
    if (!picker.hidden && selectedChartProductIds.length === 0) {
        selectedChartProductIds = productsData.slice(0, MAX_CHART_PRODUCTS).map(product => String(product.id));
    }

    options.replaceChildren();
    productsData.forEach(product => {
        const option = document.createElement('label');
        option.className = 'chart-product-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = String(product.id);
        checkbox.checked = selectedChartProductIds.includes(String(product.id));
        checkbox.addEventListener('change', () => {
            if (checkbox.checked && selectedChartProductIds.length >= MAX_CHART_PRODUCTS) {
                checkbox.checked = false;
                showToast(`Select up to ${MAX_CHART_PRODUCTS} products for this graph.`);
                return;
            }
            selectedChartProductIds = [...options.querySelectorAll('input:checked')].map(input => input.value);
            renderStockDemandProductPicker();
            updateChartData();
        });
        const name = document.createElement('span');
        name.textContent = product.name;
        option.append(checkbox, name);
        options.append(option);
    });
    label.textContent = `${selectedChartProductIds.length} of ${productsData.length} products selected`;
}

function initCharts() {
    renderStockDemandProductPicker();
    const stockDemandCtx = document.getElementById('stockDemandChart');
    const hasProducts = productsData.length > 0;
    const hasChartProducts = getChartProducts().length > 0;
    const stockDemandEmpty = document.getElementById('stock-demand-empty');
    const categoryChartEmpty = document.getElementById('category-chart-empty');
    if (stockDemandEmpty) {
        stockDemandEmpty.hidden = hasChartProducts;
        stockDemandEmpty.textContent = hasProducts
            ? 'Select at least one product to display the comparison.'
            : 'Add products to your inventory to compare stock with predicted demand.';
    }
    if (categoryChartEmpty) categoryChartEmpty.hidden = hasProducts;
    if (stockDemandCtx && hasChartProducts) {
        const chartProducts = getChartProducts();
        const labels = chartProducts.map(p => p.name);
        const stockValues = chartProducts.map(p => p.stock);
        const demandValues = chartProducts.map(p => getCalculatedMetrics(p, currentHorizon).predictedDemand);

        stockDemandChartInstance = new Chart(stockDemandCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Current Physical Stock',
                        data: stockValues,
                        backgroundColor: context => {
                            const area = context.chart.chartArea;
                            if (!area) return '#38bdf8';
                            const gradient = context.chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
                            gradient.addColorStop(0, '#2563eb');
                            gradient.addColorStop(1, '#38bdf8');
                            return gradient;
                        },
                        borderRadius: 6,
                        borderSkipped: false,
                        barPercentage: 0.65
                    },
                    {
                        label: `${getHorizonLabel()} ML Predicted Demand`,
                        data: demandValues,
                        backgroundColor: context => {
                            const area = context.chart.chartArea;
                            if (!area) return '#a78bfa';
                            const gradient = context.chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
                            gradient.addColorStop(0, '#7c3aed');
                            gradient.addColorStop(1, '#c084fc');
                            return gradient;
                        },
                        borderRadius: 6,
                        borderSkipped: false,
                        barPercentage: 0.65
                    }
                ]
            },
            plugins: [stockDemand3dPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1600,
                    easing: 'easeOutQuart',
                    delay: context => context.type === 'data'
                        ? context.dataIndex * 100 + context.datasetIndex * 120
                        : 0
                },
                animations: {
                    y: {
                        from: context => context.type === 'data'
                            ? context.chart.scales.y.getPixelForValue(0)
                            : undefined,
                        duration: 1600,
                        easing: 'easeOutQuart'
                    }
                },
                layout: { padding: { top: 12, right: 10 } },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#d4d4d8',
                            font: { family: 'Inter', size: 13 },
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        padding: 10,
                        backgroundColor: '#191a20',
                        titleColor: '#f1f5f9',
                        bodyColor: '#e4e4e7',
                        borderColor: '#3b3d47',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#343640' },
                        ticks: { color: '#a1a1aa', font: { family: 'Inter' } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#a1a1aa', font: { family: 'Inter', size: 12 } }
                    }
                }
            }
        });
    }

    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx && hasProducts) {
        const breakdown = getCategoryBreakdown();
        categoryChartInstance = new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: breakdown.map(item => item.category),
                datasets: [{
                    data: breakdown.map(item => item.demand),
                    backgroundColor: context => {
                        if (breakdown.length !== 1) {
                            return categoryChartColors[context.dataIndex % categoryChartColors.length];
                        }
                        return createSingleCategoryCanvasGradient(context.chart);
                    },
                    borderWidth: 2,
                    borderColor: '#111318'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                rotation: -Math.PI / 2,
                animation: {
                    animateRotate: true,
                    animateScale: false,
                    duration: 2000,
                    easing: 'easeOutQuart'
                },
                animations: {
                    circumference: {
                        from: 0,
                        duration: 2000,
                        easing: 'easeOutQuart'
                    },
                    rotation: {
                        from: -Math.PI / 2,
                        duration: 0
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
        renderCategoryDemandLegend(breakdown);
    }
}

// Update chart when horizon changes
function updateChartData() {
    renderSalesAndSlowMoving();
    const hasProducts = productsData.length > 0;
    const chartProducts = getChartProducts();
    const stockDemandEmpty = document.getElementById('stock-demand-empty');
    const categoryChartEmpty = document.getElementById('category-chart-empty');
    if (stockDemandEmpty) {
        stockDemandEmpty.hidden = chartProducts.length > 0;
        stockDemandEmpty.textContent = hasProducts
            ? 'Select at least one product to display the comparison.'
            : 'Add products to your inventory to compare stock with predicted demand.';
    }
    if (categoryChartEmpty) categoryChartEmpty.hidden = hasProducts;
    if (stockDemandChartInstance) {
        stockDemandChartInstance.data.labels = chartProducts.map(product => product.name);
        stockDemandChartInstance.data.datasets[0].data = chartProducts.map(product => product.stock);
        stockDemandChartInstance.data.datasets[1].data = chartProducts.map(p => getCalculatedMetrics(p, currentHorizon).predictedDemand);
        stockDemandChartInstance.data.datasets[1].label = `${getHorizonLabel()} ML Predicted Demand`;
        stockDemandChartInstance.update();
    }
    if (categoryChartInstance) {
        const breakdown = getCategoryBreakdown();
        categoryChartInstance.data.labels = breakdown.map(item => item.category);
        categoryChartInstance.data.datasets[0].data = breakdown.map(item => item.demand);
        categoryChartInstance.data.datasets[0].backgroundColor = breakdown.length === 1
            ? context => createSingleCategoryCanvasGradient(context.chart)
            : breakdown.map((_, index) => categoryChartColors[index % categoryChartColors.length]);
        categoryChartInstance.update();
        renderCategoryDemandLegend(breakdown);
    }
}

// Render AI Product Demand Forecast Matrix Table
function renderForecastProductTrends(products, searchActive) {
    const container = document.getElementById('forecast-product-trends');
    if (!container) return;
    forecastTrendCharts.forEach(chart => chart.destroy());
    forecastTrendCharts = [];
    container.replaceChildren();

    if (!products.length) {
        container.classList.add('d-none');
        return;
    }
    container.classList.remove('d-none');

    // Show a useful example on first load without rendering a chart pair for
    // every product in a large inventory. Searches can show every match.
    const trendProducts = searchActive ? products : products.slice(0, 1);

    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 13);
    const dateKeys = Array.from({ length: 14 }, (_, index) => {
        const date = new Date(startDate);
        date.setUTCDate(startDate.getUTCDate() + index);
        return date.toISOString().slice(0, 10);
    });
    const dateLabels = dateKeys.map(key => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

    trendProducts.forEach(product => {
        const section = document.createElement('section');
        section.className = 'forecast-trend-product p-3 rounded border';
        const heading = document.createElement('h6');
        heading.className = 'fw-semibold mb-3';
        heading.textContent = `${product.name} — trends`;
        section.append(heading);

        const row = document.createElement('div');
        row.className = 'row g-3';
        const salesCol = document.createElement('div');
        salesCol.className = 'col-lg-6';
        const stockCol = document.createElement('div');
        stockCol.className = 'col-lg-6';
        const salesTitle = document.createElement('div');
        salesTitle.className = 'small fw-semibold text-muted mb-2';
        salesTitle.textContent = 'Daily sales (last 14 days)';
        const stockTitle = document.createElement('div');
        stockTitle.className = 'small fw-semibold text-muted mb-2';
        stockTitle.textContent = `${getHorizonLabel()} stock: current vs AI predicted`;
        const salesStage = document.createElement('div');
        salesStage.className = 'forecast-trend-chart';
        const salesCanvas = document.createElement('canvas');
        salesStage.append(salesCanvas);
        const stockStage = document.createElement('div');
        stockStage.className = 'forecast-trend-chart';
        const stockCanvas = document.createElement('canvas');
        stockStage.append(stockCanvas);
        salesCol.append(salesTitle, salesStage);
        stockCol.append(stockTitle, stockStage);
        row.append(salesCol, stockCol);
        section.append(row);

        container.append(section);

        const salesByDate = new Map((product.salesHistory || []).map(item => [item.date, Number(item.quantity) || 0]));
        const hasRecentRecordedSales = dateKeys.some(key => salesByDate.has(key));
        if (!hasRecentRecordedSales) {
            const note = document.createElement('div');
            note.className = 'small text-muted mt-2';
            note.textContent = 'No sales have been recorded in the last 14 days. Record a sale to show it in this graph.';
            salesCol.append(note);
        }
        forecastTrendCharts.push(new Chart(salesCanvas, {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [{
                    label: 'Recorded units sold',
                    data: dateKeys.map(key => salesByDate.get(key) || 0),
                    borderColor: '#0ea5e9',
                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3
                }]
            },
            options: forecastLineChartOptions('Units sold')
        }));

        const forecastDays = Math.max(1, Number(currentHorizon) || 1);
        const currentDailyDemand = Math.max(0, Number(product.baseSalesDaily) || 0);
        const stockLabels = Array.from({ length: forecastDays + 1 }, (_, day) => day === 0 ? 'Today' : `Day ${day}`);
        const stockPrediction = stockLabels.map((_, day) => Math.max(0, Number(product.stock) - currentDailyDemand * day));
        forecastTrendCharts.push(new Chart(stockCanvas, {
            type: 'line',
            data: {
                labels: stockLabels,
                datasets: [
                    {
                        label: 'Current stock',
                        data: stockLabels.map(() => Number(product.stock)),
                        borderColor: '#94a3b8',
                        backgroundColor: 'transparent',
                        pointRadius: 0,
                        borderDash: [5, 4],
                        tension: 0
                    },
                    {
                        label: 'AI predicted stock',
                        data: stockPrediction,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.12)',
                        fill: true,
                        tension: 0.25,
                        pointRadius: forecastDays > 14 ? 0 : 2
                    }
                ]
            },
            options: forecastLineChartOptions('Units in stock')
        }));
    });
}

function forecastLineChartOptions(axisTitle) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1400, easing: 'easeOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
            legend: { position: 'bottom', labels: { color: '#cbd5e1', usePointStyle: true, boxWidth: 8 } },
            tooltip: { padding: 8 }
        },
        scales: {
            x: { grid: { display: false }, ticks: { color: '#a1a1aa', maxTicksLimit: 8 } },
            y: {
                beginAtZero: true,
                title: { display: true, text: axisTitle, color: '#a1a1aa' },
                ticks: { color: '#a1a1aa' },
                grid: { color: 'rgba(148, 163, 184, 0.14)' }
            }
        }
    };
}

function renderForecastTable() {
    const tbody = document.getElementById('forecast-tbody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('forecast-search')?.value || '').toLowerCase();
    const category = document.getElementById('category-filter')?.value || 'all';

    const filtered = productsData.filter(p => {
        const matchesCat = (category === 'all' || p.category === category);
        const matchesSearch = activeExactProductId
            ? String(p.id) === String(activeExactProductId)
            : String(p.name || '').toLowerCase().includes(searchTerm) || String(p.sku || '').toLowerCase().includes(searchTerm);
        const kpiMetrics = getCalculatedMetrics(p, 30);
        const matchesKpi = activeKpiFilter === 'all'
            || (activeKpiFilter === 'low-stock' && kpiMetrics.priority === 'HIGH')
            || (activeKpiFilter === 'critical' && kpiMetrics.priority === 'CRITICAL')
            || (activeKpiFilter === 'overstocked' && p.stock > kpiMetrics.predictedDemand * 1.5);
        return matchesCat && matchesSearch && matchesKpi;
    });

    tbody.innerHTML = '';

    if (!filtered.length) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="8" class="text-center text-muted py-4">No products match this selection.</td>`;
        tbody.appendChild(row);
        renderForecastProductTrends([], false);
        return;
    }

    filtered.forEach(product => {
        const metrics = getCalculatedMetrics(product, currentHorizon);
        
        let riskBadgeClass = 'badge-normal';
        if (metrics.priority === 'CRITICAL') riskBadgeClass = 'badge-critical';
        else if (metrics.priority === 'HIGH') riskBadgeClass = 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="d-flex align-items-center">
                    <img class="product-thumbnail me-2" src="${getProductImage(product)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.hidden=true; this.nextElementSibling.hidden=false;">
                    <div class="product-thumbnail-fallback me-2" hidden aria-hidden="true"><i class="bi bi-image"></i></div>
                    <div>
                        <div class="fw-semibold text-dark">${product.name}</div>
                        ${product.salesHistoryDays ? `<div class="text-success" style="font-size: 0.72rem;">${product.loggedSalesUnits} units sold in ${product.salesHistoryDays} tracked days</div>` : ''}
                        <div class="text-muted" style="font-size: 0.75rem;">${product.sku} • ${formatINR(product.unitCost)} / unit</div>
                    </div>
                </div>
            </td>
            <td><span class="badge bg-light text-secondary">${product.category}</span></td>
            <td class="text-center fw-bold ${product.stock < 20 ? 'text-danger' : 'text-dark'}">${product.stock} units</td>
            <td class="text-center fw-bold text-primary">${metrics.predictedDemand} units${metrics.seasonalImpactPct ? `<div class="small fw-normal ${metrics.seasonalImpactPct > 0 ? 'text-success' : 'text-muted'}">${metrics.seasonalImpactPct > 0 ? '+' : ''}${metrics.seasonalImpactPct}% seasonal</div>` : ''}</td>
            <td style="min-width: 140px;">
                <div class="d-flex justify-content-between small mb-1">
                    <span class="fw-semibold">${metrics.stockoutRisk}%</span>
                    <span class="text-muted" style="font-size: 0.7rem;">${metrics.daysLeft}d left</span>
                </div>
                <div class="progress" style="height: 6px;">
                    <div class="progress-bar ${metrics.priority === 'CRITICAL' ? 'bg-danger' : metrics.priority === 'HIGH' ? 'bg-warning' : 'bg-success'}" style="width: ${metrics.stockoutRisk}%;"></div>
                </div>
            </td>
            <td class="text-center fw-bold text-dark">${metrics.recommendedOrder > 0 ? metrics.recommendedOrder + ' units' : '<span class="text-muted">—</span>'}</td>
            <td>
                <span class="badge-pill-custom ${riskBadgeClass}">
                    ${metrics.priority === 'CRITICAL' ? '<i class="bi bi-exclamation-octagon-fill"></i>' : ''}
                    ${metrics.priority}
                </span>
            </td>
            <td class="text-end forecast-actions-cell">
                <div class="forecast-actions">
                <button class="btn btn-outline-primary btn-sm me-1 record-sale-btn" data-product-id="${product.id}" title="Record a sale">
                    <i class="bi bi-receipt me-1"></i>Sale
                </button>
                <button class="btn btn-outline-secondary btn-sm me-1" onclick="selectProductForXAI('${product.id}')" title="Explain AI Factors">
                    <i class="bi bi-search"></i>
                </button>
                <button class="btn btn-primary btn-sm" onclick="createPOFromProduct('${product.id}')" title="Auto Reorder">
                    <i class="bi bi-cart-plus me-1"></i>Reorder
                </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    renderForecastProductTrends(filtered, Boolean(searchTerm));
}

// Render Autonomous AI Reorder Engine Table
function renderReorderTable() {
    const tbody = document.getElementById('reorder-tbody');
    if (!tbody) return;

    // Filter products that actually need reordering
    const needOrder = productsData.filter(p => {
        const m = getCalculatedMetrics(p, 30);
        return m.recommendedOrder > 0 && (m.priority === 'CRITICAL' || m.priority === 'HIGH');
    });

    tbody.innerHTML = '';

    let totalVol = 0;
    let totalCapital = 0;

    needOrder.forEach(product => {
        const metrics = getCalculatedMetrics(product, 30);
        totalVol += metrics.recommendedOrder;
        totalCapital += metrics.estimatedCost;

        let riskBadgeClass = 'badge-normal';
        if (metrics.priority === 'CRITICAL') riskBadgeClass = 'badge-critical';
        else if (metrics.priority === 'HIGH') riskBadgeClass = 'badge-warning';

        const tr = document.createElement('tr');
        tr.id = `reorder-row-${product.id}`;
        tr.innerHTML = `
            <td>
                <div class="fw-semibold text-dark">${product.name}</div>
                <div class="text-muted" style="font-size: 0.72rem;">${product.sku} • ${product.category}</div>
            </td>
            <td>
                <div class="small fw-semibold text-danger">${product.stock} units left</div>
                <div class="text-muted" style="font-size: 0.7rem;">30d Demand: ${metrics.predictedDemand}</div>
            </td>
            <td>
                <span class="badge-pill-custom ${riskBadgeClass}">${metrics.stockoutRisk}% Risk</span>
            </td>
            <td>
                <div class="small fw-medium">${product.supplier}</div>
                <div class="text-muted" style="font-size: 0.7rem;">Lead Time: ${product.leadDays} Days</div>
            </td>
            <td class="text-center fw-bold text-primary fs-6">
                ${metrics.recommendedOrder}
            </td>
            <td>
                <div class="fw-bold small text-dark">${formatINR(metrics.estimatedCost)}</div>
                <div class="text-muted" style="font-size: 0.7rem;">@ ${formatINR(product.unitCost)}/u</div>
            </td>
            <td class="text-end">
                <button class="btn btn-primary btn-sm text-nowrap" id="btn-reorder-${product.id}" onclick="createPOFromProduct('${product.id}')">
                    <i class="bi bi-file-earmark-plus me-1"></i>Create PO
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update header summary numbers
    const summaryCount = document.getElementById('summary-reorder-count');
    const summaryVol = document.getElementById('summary-reorder-vol');
    const summaryCost = document.getElementById('summary-reorder-cost');
    const kpiCapital = document.getElementById('kpi-reorder-capital');
    const sidebarBadge = document.getElementById('sidebar-reorder-badge');

    if (summaryCount) summaryCount.textContent = needOrder.length;
    if (summaryVol) summaryVol.textContent = totalVol + ' Units';
    if (summaryCost) summaryCost.textContent = formatINR(totalCapital);
    if (kpiCapital) kpiCapital.textContent = formatINR(totalCapital);
    if (sidebarBadge) {
        sidebarBadge.textContent = `${needOrder.length} Urg`;
        sidebarBadge.classList.toggle('d-none', needOrder.length === 0);
    }
    renderNotificationAlerts();
}

// Select a product to display in Explainable AI (XAI) Panel
function selectProductForXAI(productId) {
    const product = productsData.find(p => p.id === productId);
    if (!product) return;

    updateXAIView(product);

    // Sync select dropdown in XAI section if present
    const selectEl = document.getElementById('xai-stock-select');
    if (selectEl) selectEl.value = productId;

    // Switch to XAI section
    showSection('xai-section');
}

// Update XAI Factor Breakdown
function getProductDriverWeights(selectedProduct) {
    const keys = ['salesTrend', 'seasonality', 'leadTime', 'priceElasticity', 'categoryMomentum'];
    const productDrivers = productsData.map(product => {
        const metrics = getCalculatedMetrics(product, 30);
        return {
            product,
            values: {
                salesTrend: Math.max(0, Number(product.baseSalesDaily) || 0),
                seasonality: 1 / Math.max(metrics.daysLeft, 1),
                leadTime: Math.max(0, Number(product.leadDays) || 0),
                priceElasticity: Math.max(0, Number(product.unitCost) || 0),
                categoryMomentum: Math.max(0, metrics.predictedDemand)
            }
        };
    });
    const selected = productDrivers.find(entry => entry.product.id === selectedProduct.id);
    if (!selected) return Object.fromEntries(keys.map(key => [key, 20]));

    const relativeScores = Object.fromEntries(keys.map(key => {
        const portfolioMax = Math.max(...productDrivers.map(entry => entry.values[key]));
        return [key, portfolioMax > 0 ? selected.values[key] / portfolioMax : 0];
    }));
    const total = Object.values(relativeScores).reduce((sum, value) => sum + value, 0);
    if (!total) return Object.fromEntries(keys.map(key => [key, 20]));

    const weights = Object.fromEntries(keys.map(key => [key, Math.round(relativeScores[key] / total * 100)]));
    const difference = 100 - Object.values(weights).reduce((sum, value) => sum + value, 0);
    const largestDriver = keys.reduce((largest, key) => relativeScores[key] > relativeScores[largest] ? key : largest, keys[0]);
    weights[largestDriver] += difference;
    return weights;
}

function updateXAIView(product) {
    const metrics = getCalculatedMetrics(product, 30);

    document.getElementById('xai-product-name').textContent = product.name;
    document.getElementById('xai-meta').textContent = `Lead Time: ${product.leadDays} Days • Stock: ${product.stock} • Risk: ${metrics.stockoutRisk}%`;

    const riskPill = document.getElementById('xai-risk-pill');
    const riskClass = metrics.priority === 'CRITICAL' ? 'badge-critical'
        : metrics.priority === 'HIGH' ? 'badge-warning' : 'badge-normal';
    riskPill.className = `badge badge-pill-custom ${riskClass}`;
    riskPill.textContent = `${metrics.stockoutRisk}% ${metrics.priority} Risk`;

    const coverageText = `Current stock covers about ${metrics.daysLeft} days at the forecast rate of ${product.baseSalesDaily} units per day.`;
    const contextText = metrics.seasonalImpactPct
        ? `Season, product type, and India holiday calendar factors (${metrics.seasonalReasons.join(', ') || 'seasonal pattern'}) change the 30-day demand estimate by ${metrics.seasonalImpactPct > 0 ? '+' : ''}${metrics.seasonalImpactPct}%.`
        : 'No significant seasonal or festival adjustment applies during this forecast window.';
    const salesHistoryText = product.salesHistoryDays
        ? `Demand is adjusted using ${product.loggedSalesUnits} units sold over ${product.salesHistoryDays} tracked days, blended with the entered baseline of ${product.baselineSalesDaily} units per day.`
        : `No sales have been recorded yet; the forecast uses the entered baseline of ${product.baselineSalesDaily || product.baseSalesDaily} units per day.`;
    const riskText = metrics.priority === 'CRITICAL'
        ? `Stock may run out before the ${product.leadDays}-day supplier lead time.`
        : metrics.priority === 'HIGH'
            ? `Stock is approaching the ${product.leadDays}-day supplier lead-time window.`
            : `Stock currently covers the ${product.leadDays}-day supplier lead time.`;
    const orderText = metrics.recommendedOrder > 0
        ? `The 30-day plan suggests ordering ${metrics.recommendedOrder} units.`
        : 'No replenishment order is suggested for the selected horizon.';
    document.getElementById('xai-narrative').textContent = `${salesHistoryText} ${contextText} ${coverageText} ${riskText} ${orderText}`;

    const orderTitle = document.getElementById('xai-order-title');
    const orderNote = document.getElementById('xai-order-note');
    const orderButton = document.getElementById('xai-order-btn');
    const orderButtonLabel = document.getElementById('xai-order-button-label');
    if (orderTitle) orderTitle.textContent = metrics.recommendedOrder > 0
        ? `30-Day Replenishment Plan: ${metrics.recommendedOrder} units`
        : 'No Replenishment Needed';
    if (orderNote) orderNote.textContent = metrics.priority === 'NORMAL'
        ? 'Stock covers the lead-time window; this plan is based on 30-day demand.'
        : 'Suggested to replenish before the lead-time window closes.';
    if (orderButton) orderButton.disabled = metrics.recommendedOrder <= 0;
    if (orderButtonLabel) orderButtonLabel.textContent = metrics.recommendedOrder > 0
        ? `Create ${metrics.recommendedOrder}-Unit Purchase Order`
        : 'No Purchase Order Needed';

    // Animate factor weights
    const factors = getProductDriverWeights(product);
    document.getElementById('factor-sales').textContent = factors.salesTrend + '%';
    document.getElementById('bar-sales').style.width = factors.salesTrend + '%';

    document.getElementById('factor-season').textContent = factors.seasonality + '%';
    document.getElementById('bar-season').style.width = factors.seasonality + '%';

    document.getElementById('factor-lead').textContent = factors.leadTime + '%';
    document.getElementById('bar-lead').style.width = factors.leadTime + '%';

    document.getElementById('factor-price').textContent = factors.priceElasticity + '%';
    document.getElementById('bar-price').style.width = factors.priceElasticity + '%';

    document.getElementById('factor-category').textContent = factors.categoryMomentum + '%';
    document.getElementById('bar-category').style.width = factors.categoryMomentum + '%';
}

// Create Purchase Order from Product SKU (1-Click Autonomous Action)
function createPOFromProduct(productId) {
    const product = productsData.find(p => p.id === productId);
    if (!product) return;

    const metrics = getCalculatedMetrics(product, 30);
    const qty = metrics.recommendedOrder || 50;

    // Generate unique PO ID
    const newId = `PO-2026-${String(Math.floor(892 + purchaseOrders.length)).padStart(4, '0')}`;
    const today = new Date().toISOString().split('T')[0];

    const newPO = {
        id: newId,
        date: today,
        productId: product.id,
        sku: product.sku,
        item: product.name,
        qty: qty,
        supplier: product.supplier,
        leadTime: `${product.leadDays} Days`,
        unitCost: product.unitCost,
        total: qty * product.unitCost,
        status: 'Pending Approval'
    };

    // Add to PO Register at top
    purchaseOrders.unshift(newPO);

    // Visual feedback on button
    const btn = document.getElementById(`btn-reorder-${productId}`);
    if (btn) {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        btn.innerHTML = '<i class="bi bi-check2"></i> PO Created';
        btn.disabled = true;
    }

    renderPOTable();
    showToast(`Autonomous Purchase Order <strong>${newId}</strong> created for ${product.name}! <a href="#po-section" onclick="showSection('po-section'); return false;" class="text-warning fw-semibold text-decoration-underline ms-2">View in PO Register ⟶</a>`);

    // Update PO badge in sidebar
    const poBadge = document.getElementById('sidebar-po-badge');
    if (poBadge) {
        poBadge.textContent = purchaseOrders.length;
        poBadge.classList.toggle('d-none', purchaseOrders.length === 0);
    }
}

// Batch Approve All Critical Orders
function batchApproveCriticalOrders() {
    const criticals = productsData.filter(p => getCalculatedMetrics(p, 30).priority === 'CRITICAL');
    
    let createdCount = 0;
    criticals.forEach(product => {
        // Check if already in pending/approved POs
        const existing = purchaseOrders.find(po => po.productId === product.id && po.status !== 'Received');
        if (!existing) {
            const metrics = getCalculatedMetrics(product, 30);
            const newId = `PO-2026-${String(Math.floor(892 + purchaseOrders.length)).padStart(4, '0')}`;
            purchaseOrders.unshift({
                id: newId,
                date: new Date().toISOString().split('T')[0],
                productId: product.id,
                sku: product.sku,
                item: product.name,
                qty: metrics.recommendedOrder,
                supplier: product.supplier,
                leadTime: `${product.leadDays} Days`,
                unitCost: product.unitCost,
                total: metrics.estimatedCost,
                status: 'Approved' // auto-approved in batch
            });
            createdCount++;
        }
    });

    renderPOTable();
    showToast(`Batch approved & generated ${createdCount || 'critical'} formal Purchase Orders! <a href="#po-section" onclick="showSection('po-section'); return false;" class="text-warning fw-semibold text-decoration-underline ms-2">Open PO Register ⟶</a>`);
}

// Render PO Register Table
function renderPOTable(statusFilter = 'all') {
    const tbody = document.getElementById('po-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filtered = purchaseOrders.filter(po => {
        if (!statusFilter || statusFilter === 'all') return true;
        return po.status === statusFilter;
    });

    filtered.forEach(po => {
        let statusBadgeClass = 'badge-warning';
        if (po.status === 'Approved') statusBadgeClass = 'badge-info';
        else if (po.status === 'Received') statusBadgeClass = 'badge-normal';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <span class="fw-bold text-primary font-monospace">${po.id}</span>
            </td>
            <td class="text-muted small">${po.date}</td>
            <td>
                <div class="fw-semibold text-dark">${po.item}</div>
                <div class="text-muted" style="font-size: 0.72rem;">Qty: <strong>${po.qty} units</strong> (${po.sku})</div>
            </td>
            <td>${po.supplier}</td>
            <td class="text-muted small">${po.leadTime}</td>
            <td class="fw-bold text-dark">${formatINR(po.total)}</td>
            <td>
                <span class="badge-pill-custom ${statusBadgeClass}">
                    ${po.status}
                </span>
            </td>
            <td class="text-end text-nowrap">
                ${po.status === 'Pending Approval' ? 
                    `<button class="btn btn-outline-success btn-sm me-1" onclick="approvePO('${po.id}')" title="Approve PO">
                        <i class="bi bi-check-lg me-1"></i>Approve
                     </button>` : ''}
                ${po.status === 'Approved' ? 
                    `<button class="btn btn-outline-primary btn-sm me-1" onclick="markPOReceived('${po.id}')" title="Mark as Received">
                        <i class="bi bi-box-arrow-in-down me-1"></i>Receive
                     </button>` : ''}
                <button class="btn btn-light btn-sm" onclick="viewPODocument('${po.id}')" title="View / Print Formal PO">
                    <i class="bi bi-receipt"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const sidebarPoBadge = document.getElementById('sidebar-po-badge');
    if (sidebarPoBadge) {
        sidebarPoBadge.textContent = purchaseOrders.length;
        sidebarPoBadge.classList.toggle('d-none', purchaseOrders.length === 0);
    }
}

// Action: Approve PO
function approvePO(poId) {
    const po = purchaseOrders.find(p => p.id === poId);
    if (po) {
        po.status = 'Approved';
        renderPOTable();
        showToast(`${poId} Approved by Management. Ready for vendor dispatch.`);
    }
}

// Action: Mark PO Received & Replenish Stock
async function markPOReceived(poId) {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return;
    const product = productsData.find(p => p.id === po.productId);
    if (!product) {
        showToast('This purchase order is not linked to a product in your inventory.');
        return;
    }

    try {
        const response = await fetch(`/api/business/products/${encodeURIComponent(po.productId)}/stock`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantity: po.qty })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Could not save the restock.');

        po.status = 'Received';
        product.stock = result.data.stock;
        renderForecastTable();
        renderReorderTable();
        renderAllProductAnalysis();
        if (document.getElementById('xai-stock-select')?.value === product.id) updateXAIView(product);
        updateBusinessKpis();
        updateChartData();
        renderPOTable();
        showToast(`Stock replenished! ${po.qty} units added for ${po.item}.`);
    } catch (error) {
        showToast(error.message || 'Could not save the restock. Please try again.');
    }
}

// View and Pop Up Official Printable PO Invoice Modal
function viewPODocument(poId) {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return;

    document.getElementById('modal-po-id').textContent = po.id;
    document.getElementById('modal-po-date').textContent = po.date;
    document.getElementById('modal-po-status').textContent = po.status;
    document.getElementById('modal-po-supplier').textContent = po.supplier;
    document.getElementById('modal-po-lead').textContent = po.leadTime;
    document.getElementById('modal-po-item').textContent = po.item;
    document.getElementById('modal-po-sku').textContent = po.sku;
    document.getElementById('modal-po-qty').textContent = po.qty;
    document.getElementById('modal-po-price').textContent = formatINR(po.unitCost);
    document.getElementById('modal-po-total').textContent = formatINR(po.total);
    document.getElementById('modal-po-subtotal').textContent = formatINR(po.total);
    
    const tax = Math.round(po.total * 0.18);
    document.getElementById('modal-po-tax').textContent = formatINR(tax);
    document.getElementById('modal-po-grandtotal').textContent = formatINR(po.total + tax);

    const poModal = new bootstrap.Modal(document.getElementById('poModal'));
    poModal.show();
}

// Export CSV of Purchase Orders
function exportPOCsv() {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "PO Number,Date,SKU,Item,Quantity,Supplier,Lead Time,Total INR,Status\n";

    purchaseOrders.forEach(po => {
        csvContent += `"${po.id}","${po.date}","${po.sku}","${po.item}",${po.qty},"${po.supplier}","${po.leadTime}",${po.total},"${po.status}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FinSight_Purchase_Orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Purchase Orders exported to CSV!");
}

// Render Workforce Roster Table
function renderWorkforceRoster() {
    const tbody = document.getElementById('roster-tbody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('roster-search')?.value || '').toLowerCase();

    tbody.innerHTML = '';

    const filtered = workforceData.filter(emp => {
        return emp.name.toLowerCase().includes(searchTerm) || emp.role.toLowerCase().includes(searchTerm) || emp.branch.toLowerCase().includes(searchTerm);
    });

    filtered.forEach(emp => {
        let statusBadge = 'badge-normal';
        if (emp.status === 'Absent') statusBadge = 'badge-critical';
        else if (emp.status === 'On Leave') statusBadge = 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="fw-semibold text-dark">${emp.name}</div>
                <div class="text-muted" style="font-size: 0.72rem;">${emp.id}</div>
            </td>
            <td><span class="badge bg-light text-dark">${emp.branch}</span></td>
            <td>${emp.role}</td>
            <td><span class="badge-pill-custom ${statusBadge}">${emp.status}</span></td>
            <td class="fw-semibold">${emp.attendance}%</td>
            <td>
                <div class="d-flex align-items-center">
                    <span class="fw-bold me-2 text-primary">${emp.prod}%</span>
                    <div class="progress flex-grow-1" style="height: 5px;">
                        <div class="progress-bar bg-primary" style="width: ${emp.prod}%;"></div>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Retrain model trigger simulation
function triggerModelRetrain() {
    showToast("Triggering Gradient Boosting & SHAP explainer retraining...");
    setTimeout(() => {
        showToast("Model retrained successfully. All forecast parameters refreshed.");
    }, 1200);
}

// Reset Demo Data
function resetDemoData() {
    productsData[0].stock = 18;
    productsData[1].stock = 24;
    productsData[2].stock = 14;
    renderForecastTable();
    renderReorderTable();
    updateChartData();
    showToast("Demo dataset reset to initial state.");
}

// Show Toast Notification
function showToast(message) {
    const toastEl = document.getElementById('liveToast');
    const toastMsg = document.getElementById('toast-msg');
    if (toastEl && toastMsg) {
        toastMsg.innerHTML = message;
        const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toast.show();
    }
}
