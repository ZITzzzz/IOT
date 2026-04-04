const API_URL = 'http://localhost:5000/api';
let currentLimit = 10;
let searchTimer = null;

function toggleSearchPanel() {
    document.getElementById('searchPanel').classList.toggle('active');
}

function changeLimit() {
    currentLimit = parseInt(document.getElementById('limitSelect').value);
    loadData(1);
}

// Tìm kiếm tự do: gõ bất kỳ chuỗi → backend LIKE khớp tất cả cột
function doSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    loadData(1);
}

function debouncedSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadData(1), 400);
}

function clearTextSearch() {
    document.getElementById('textSearch').value = '';
    loadData(1);
}

function resetSearch() {
    ['sDay','sMonth','sYear','sHour','sMin','sSec'].forEach(id => {
        document.getElementById(id).value = '';
    });
    ['minTemp','maxTemp','minHum','maxHum','minLight','maxLight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    loadData(1);
}

function applyQuickFilter() {
    const range = document.getElementById('quickRange').value;
    if (!range) return;

    const now = new Date();
    let startTime = new Date(now);

    switch (range) {
        case '30m': startTime.setMinutes(now.getMinutes() - 30); break;
        case '1h':  startTime.setHours(now.getHours() - 1); break;
        case '12h': startTime.setHours(now.getHours() - 12); break;
        case '24h': startTime.setHours(now.getHours() - 24); break;
        case '3d':  startTime.setDate(now.getDate() - 3); break;
    }

    document.getElementById('sYear').value  = startTime.getFullYear();
    document.getElementById('sMonth').value = startTime.getMonth() + 1;
    document.getElementById('sDay').value   = startTime.getDate();
    document.getElementById('sHour').value  = startTime.getHours();
    document.getElementById('sMin').value   = startTime.getMinutes();
    document.getElementById('sSec').value   = '00';

    loadData(1);
}

async function loadData(page = 1) {
    const d   = document.getElementById('sDay').value;
    const m   = document.getElementById('sMonth').value;
    const y   = document.getElementById('sYear').value;
    const h   = document.getElementById('sHour').value;
    const min = document.getElementById('sMin').value;
    const s   = document.getElementById('sSec').value;

    let startDate = '', endDate = '';
    if (d && m && y) {
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (h !== '') {
            const timeStr = `${String(h).padStart(2,'0')}:${String(min||0).padStart(2,'0')}:${String(s||0).padStart(2,'0')}`;
            startDate = `${dateStr} ${timeStr}`;
        } else {
            startDate = `${dateStr} 00:00:00`;
            endDate   = `${dateStr} 23:59:59`;
        }
    }

    let url = `${API_URL}/sensor-history?page=${page}&limit=${currentLimit}`;
    if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
    if (endDate)   url += `&end_date=${encodeURIComponent(endDate)}`;

    // Tìm kiếm tự do
    const searchText = document.getElementById('textSearch')?.value.trim();
    if (searchText) url += `&search=${encodeURIComponent(searchText)}`;

    // Sensor value filters
    const minTemp  = document.getElementById('minTemp')?.value;
    const maxTemp  = document.getElementById('maxTemp')?.value;
    const minHum   = document.getElementById('minHum')?.value;
    const maxHum   = document.getElementById('maxHum')?.value;
    const minLight = document.getElementById('minLight')?.value;
    const maxLight = document.getElementById('maxLight')?.value;

    if (minTemp)  url += `&min_temp=${minTemp}`;
    if (maxTemp)  url += `&max_temp=${maxTemp}`;
    if (minHum)   url += `&min_hum=${minHum}`;
    if (maxHum)   url += `&max_hum=${maxHum}`;
    if (minLight) url += `&min_light=${minLight}`;
    if (maxLight) url += `&max_light=${maxLight}`;

    try {
        const res = await fetch(url);
        const result = await res.json();

        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';

        if (result.data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">Không tìm thấy dữ liệu</td></tr>`;
        } else {
            result.data.forEach((item, index) => {
                const rowNum = (page - 1) * currentLimit + index + 1;
                const dateDisplay = new Date(item.created_at).toLocaleString('vi-VN');
                tbody.innerHTML += `
                    <tr>
                        <td>#${rowNum}</td>
                        <td class="txt-hum">${parseFloat(item.humidity).toFixed(1)}%</td>
                        <td class="txt-light">${parseFloat(item.light).toFixed(1)} LUX</td>
                        <td class="txt-temp">${parseFloat(item.temperature).toFixed(1)}°C</td>
                        <td>${dateDisplay}</td>
                    </tr>
                `;
            });
        }

        const pagContainer = document.getElementById('paginationNumbers');
        pagContainer.innerHTML = '';
        const totalPages = result.pagination.totalPages;
        document.getElementById('pageInfo').innerText = `Trang ${page} / ${totalPages}`;

        let startPage = Math.max(1, page - 2);
        let endPage   = Math.min(totalPages, page + 2);

        if (startPage > 1) pagContainer.innerHTML += `<button class="p-btn" onclick="loadData(1)">1</button>`;
        if (startPage > 2) pagContainer.innerHTML += `<span>...</span>`;

        for (let i = startPage; i <= endPage; i++) {
            pagContainer.innerHTML += `<button class="p-btn ${i === page ? 'active' : ''}" onclick="loadData(${i})">${i}</button>`;
        }

        if (endPage < totalPages - 1) pagContainer.innerHTML += `<span>...</span>`;
        if (endPage < totalPages)     pagContainer.innerHTML += `<button class="p-btn" onclick="loadData(${totalPages})">${totalPages}</button>`;

    } catch (e) { console.error(e); }
}

function goToPage() {
    const input = document.getElementById('gotoInput');
    const page = parseInt(input.value);
    if (page > 0) loadData(page);
}

loadData(1);
