const API_URL = 'http://localhost:5000/api';
let currentLimit = 10;

function copyTime(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        btn.title = 'Đã copy!';
        setTimeout(() => btn.title = 'Copy', 1500);
    });
}

function toggleSearchPanel() {
    document.getElementById('searchPanel').classList.toggle('active');
}

function changeLimit() {
    currentLimit = parseInt(document.getElementById('limitSelect').value);
    loadHistory(1);
}

function parseDateTime(text) {
    const now = new Date();
    text = text.trim();

    // Chỉ giờ: "20" | "20:51" | "20:51:16"
    const timeOnly = text.match(/^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?$/);
    if (timeOnly && +timeOnly[1] <= 23) {
        return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), +timeOnly[1], +(timeOnly[2]||0), +(timeOnly[3]||0)), dateOnly: false, hasSeconds: !!timeOnly[3] };
    }

    // Chỉ ngày: "26/3" | "26/3/2026"
    const dateOnlyVN = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (dateOnlyVN) {
        const [, d, m, y] = dateOnlyVN;
        return { date: new Date(+(y||now.getFullYear()), +m-1, +d), dateOnly: true };
    }

    // Ngày+giờ vi-VN: "20:51 26/3/2026" | "20:51:16 26/3/2026" | "20:51 26/3" (năm tùy chọn)
    const viMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (viMatch) {
        const [, h, min, s, d, m, y] = viMatch;
        return { date: new Date(+(y||now.getFullYear()), +m-1, +d, +h, +min, +(s||0)), dateOnly: false, hasSeconds: !!s };
    }

    // ISO: "2026-03-26" | "2026-03-26 20:51" | "2026-03-26 20:51:16"
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
        const [, y, m, d, h, min, s] = isoMatch;
        return { date: new Date(+y, +m-1, +d, +(h||0), +(min||0), +(s||0)), dateOnly: !h, hasSeconds: !!s };
    }

    return null;
}

function parseAndSearch() {
    const text = document.getElementById('textSearch').value.trim();
    if (!text) return;
    const result = parseDateTime(text);
    if (!result || isNaN(result.date)) {
        alert('Định dạng không hợp lệ.\nVí dụ: "20:51" | "26/3" | "26/3/2026" | "20:51:16 26/3/2026"');
        return;
    }
    const d = result.date;
    document.getElementById('sDay').value   = d.getDate();
    document.getElementById('sMonth').value = d.getMonth() + 1;
    document.getElementById('sYear').value  = d.getFullYear();
    if (result.dateOnly) {
        document.getElementById('sHour').value = '';
        document.getElementById('sMin').value  = '';
        document.getElementById('sSec').value  = '';
    } else {
        document.getElementById('sHour').value = d.getHours();
        document.getElementById('sMin').value  = d.getMinutes();
        // Lưu giây thực nếu user nhập giây, rỗng nếu chỉ gõ HH:MM
        document.getElementById('sSec').value  = result.hasSeconds ? d.getSeconds() : '';
    }
    loadHistory(1);
}

function clearTextSearch() {
    document.getElementById('textSearch').value = '';
    resetSearch();
}

function resetSearch() {
    document.getElementById('sDay').value = "";
    document.getElementById('sMonth').value = "";
    document.getElementById('sYear').value = "";
    document.getElementById('sHour').value = "";
    document.getElementById('sMin').value = "";
    document.getElementById('sSec').value = "";
    document.getElementById('deviceFilter').value = "all";
    document.getElementById('actionFilter').value = "all";
    document.getElementById('statusFilter').value = "all";
    loadHistory(1);
}

async function loadHistory(page = 1) {
    const deviceId = document.getElementById('deviceFilter').value;
    const action   = document.getElementById('actionFilter').value;
    const status   = document.getElementById('statusFilter').value;
    
    const d = document.getElementById('sDay').value;
    const m = document.getElementById('sMonth').value;
    const y = document.getElementById('sYear').value;
    const h = document.getElementById('sHour').value;
    const min = document.getElementById('sMin').value;
    const s = document.getElementById('sSec').value;

    let startDate = "", endDate = "";
    if(d && m && y) {
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if(h !== '') {
            const hh = String(h).padStart(2,'0');
            const mm = String(min||0).padStart(2,'0');
            const ss = s !== '' ? String(s).padStart(2,'0') : '00';
            startDate = `${dateStr} ${hh}:${mm}:${ss}`;
            if (s === '') {
                // Chỉ nhập HH:MM → lấy trọn phút (xx:MM:00 → xx:MM:59)
                endDate = `${dateStr} ${hh}:${mm}:59`;
            } else {
                // Nhập HH:MM:SS → khớp đúng giây đó
                endDate = startDate;
            }
        } else {
            startDate = `${dateStr} 00:00:00`;
            endDate   = `${dateStr} 23:59:59`;
        }
    }

    // Gọi API (Backend: iotController.getActionHistory)
    let url = `${API_URL}/action-history?page=${page}&limit=${currentLimit}`;
    if (deviceId !== 'all') url += `&device_id=${deviceId}`;
    if (action !== 'all')   url += `&action=${encodeURIComponent(action)}`;
    if (status !== 'all')   url += `&status=${status}`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;

    try {
        const res = await fetch(url);
        const result = await res.json();
        
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = "";

        if (result.data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">Không tìm thấy dữ liệu</td></tr>`;
        } else {
            result.data.forEach(item => {
                let badgeClass = item.status === "SUCCESS" ? "bg-on" : "bg-off";
                let actionStyle = item.action === "TURN ON" ? "color:#166534; font-weight:bold" : "color:#991b1b; font-weight:bold";
                let dateDisplay = new Date(item.created_at).toLocaleString('vi-VN');

                tbody.innerHTML += `
                    <tr>
                        <td>#${item.id}</td>
                        <td style="font-weight: 500;">${item.device_name}</td>
                        <td style="${actionStyle}">${item.action}</td>
                        <td style="white-space:nowrap">
                            ${dateDisplay}
                            <button onclick="copyTime('${dateDisplay}', this)" title="Copy"
                                style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:0 3px;vertical-align:middle;font-size:0.85em">
                                <i class="fas fa-copy"></i>
                            </button>
                        </td>
                        <td><span class="badge ${badgeClass}">${item.status}</span></td>
                    </tr>
                `;
            });
        }

        const pagContainer = document.getElementById('paginationNumbers');
        pagContainer.innerHTML = "";
        const totalPages = result.pagination.totalPages;
        document.getElementById('pageInfo').innerText = `Trang ${page} / ${totalPages}`;

        let startPage = Math.max(1, page - 2);
        let endPage = Math.min(totalPages, page + 2);

        if (startPage > 1) pagContainer.innerHTML += `<button class="p-btn" onclick="loadHistory(1)">1</button>`;
        if (startPage > 2) pagContainer.innerHTML += `<span>...</span>`;
        
        for(let i=startPage; i<=endPage; i++) {
             pagContainer.innerHTML += `<button class="p-btn ${i === page ? 'active' : ''}" onclick="loadHistory(${i})">${i}</button>`;
        }

        if (endPage < totalPages - 1) pagContainer.innerHTML += `<span>...</span>`;
        if (endPage < totalPages) pagContainer.innerHTML += `<button class="p-btn" onclick="loadHistory(${totalPages})">${totalPages}</button>`;

    } catch (e) { console.error(e); }
}

loadHistory(1);