// 1. KẾT NỐI SOCKET.IO — gửi lastSensorTime để server tự tính gap
const lastSensorTime = localStorage.getItem('lastSensorTime') || '';
const socket = io("http://localhost:5000", {
    query: { lastSensorTime }
});
const API_URL = 'http://localhost:5000/api';

// Biến lưu timeout để xử lý lỗi nếu phần cứng không phản hồi
let timeouts = {}; 

// 2. CẤU HÌNH BIỂU ĐỒ (Giữ nguyên)
const ctx = document.getElementById('combinedChart').getContext('2d');
const combinedChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            { label: 'Nhiệt độ', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.2)', fill: true, tension: 0.4, yAxisID: 'y' },
            { label: 'Độ ẩm', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', fill: true, tension: 0.4, yAxisID: 'y' },
            { label: 'Ánh sáng', data: [], borderColor: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.2)', fill: true, tension: 0.4, yAxisID: 'y1' }
        ]
    },
    options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, 
        scales: {
            x: { grid: { display: false } },
            y: { type: 'linear', display: true, position: 'left', min: 0, max: 100 },
            y1: { type: 'linear', display: true, position: 'right', min: 0, max: 1000, grid: { drawOnChartArea: false } }
        }
    }
});

// --- PHẦN LOGIC REALTIME (SOCKET) ---

// Sự kiện 1: Init Data
socket.on('init_data', (data) => {
    console.log("⚡ Đã kết nối Socket, nhận data init:", data);

    if (data.sensors && data.sensors.length > 0) {
        const times = data.sensors.map(d => new Date(d.created_at).toLocaleTimeString('vi-VN'));
        combinedChart.data.labels = times;
        combinedChart.data.datasets[0].data = data.sensors.map(d => d.temperature);
        combinedChart.data.datasets[1].data = data.sensors.map(d => d.humidity);
        combinedChart.data.datasets[2].data = data.sensors.map(d => d.light);
        combinedChart.update();

        const latest = data.sensors[data.sensors.length - 1];
        updateCards(latest);
    }

    if (data.devices) {
        data.devices.forEach(d => {
            // Dùng d.code (tiếng Anh) để khớp với HTML element ID: sw-pump, sw-heater, sw-mist
            const checkbox = document.getElementById(`sw-${d.code}`);
            const card = document.getElementById(`card-${d.code}`);
            if (checkbox) {
                const isOn = (d.current_status === 'ON');
                checkbox.checked = isOn;
                if(isOn) card.classList.add('active');
                else card.classList.remove('active');
            }
        });
    }
});

// Sự kiện 2: Sensor mới
socket.on('new_sensor', (data) => {
    localStorage.setItem('lastSensorTime', data.created_at);
    updateCards(data);
    const timeLabel = new Date(data.created_at).toLocaleTimeString('vi-VN');
    
    if (combinedChart.data.labels.length > 20) {
        combinedChart.data.labels.shift();
        combinedChart.data.datasets.forEach(d => d.data.shift());
    }

    combinedChart.data.labels.push(timeLabel);
    combinedChart.data.datasets[0].data.push(data.temperature);
    combinedChart.data.datasets[1].data.push(data.humidity);
    combinedChart.data.datasets[2].data.push(data.light);
    combinedChart.update();
});

// --- SỰ KIỆN QUAN TRỌNG: NHẬN PHẢN HỒI TỪ ESP32 ---
socket.on('device_update', (data) => {
    console.log("✅ Giao diện nhận xác nhận từ ESP32:", data);
    
    const code = data.code; // 'pump', 'heater', 'mist'
    const checkbox = document.getElementById(`sw-${code}`);
    const loader = document.getElementById(`load-${code}`);
    const card = document.getElementById(`card-${code}`);

    // 1. Xóa Timeout báo lỗi (Vì đã thành công rồi)
    if (timeouts[code]) {
        clearTimeout(timeouts[code]);
        delete timeouts[code];
    }

    if (checkbox) {
        // 2. Cập nhật trạng thái thật của nút gạt
        const isOn = (data.status === 'ON');
        checkbox.checked = isOn;

        // 3. Hiệu ứng Active cho Card
        if (isOn) card.classList.add('active');
        else card.classList.remove('active');

        // 4. Tắt Loading, Hiện lại nút gạt (QUAN TRỌNG)
        if(loader) loader.style.display = 'none';
        // Hiển thị lại nút gạt (block hoặc inline-block tùy css)
        checkbox.parentElement.style.display = 'inline-block'; 
        checkbox.style.display = 'block'; 
    }
});

// --- CÁC HÀM HỖ TRỢ ---
function updateCards(data) {
    document.getElementById('temp-val').innerText = `${parseFloat(data.temperature).toFixed(1)}°C`;
    document.getElementById('hum-val').innerText = `${parseFloat(data.humidity).toFixed(1)}%`;
    document.getElementById('light-val').innerText = `${parseFloat(data.light).toFixed(1)} Lux`;
}

// --- HÀM GỌI API ĐIỀU KHIỂN (ĐÃ SỬA LOGIC) ---
async function toggleDevice(code, checkbox) {
    const loader = document.getElementById(`load-${code}`);
    const switchLabel = checkbox.parentElement; // Lấy thẻ label chứa nút gạt
    const action = checkbox.checked ? 'ON' : 'OFF';

    // 1. UI: Ẩn nút gạt, Hiện Loading ngay lập tức
    switchLabel.style.display = 'none'; 
    if(loader) loader.style.display = 'inline-block';

    try {
        // 2. Gửi lệnh API (Chỉ gửi, chưa xong)
        await fetch(`${API_URL}/control`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code, action })
        });
        
        // --- KHÔNG CÓ finally Ở ĐÂY ---
        // Chúng ta giữ nguyên trạng thái Loading và chờ Socket...

        // 3. Cài Timeout 5s: Nếu sau 5s Socket không báo về -> Báo lỗi
        timeouts[code] = setTimeout(() => {
            alert(`❌ Thiết bị ${code} không phản hồi sau 5s!`);
            
            // Hoàn tác UI (Revert) về trạng thái cũ
            if(loader) loader.style.display = 'none';
            switchLabel.style.display = 'inline-block';
            checkbox.checked = !checkbox.checked; // Đảo lại nút vì thất bại
        }, 5000);

    } catch (e) {
        console.error(e);
        alert("Lỗi kết nối tới Server!");
        
        // Hoàn tác UI ngay nếu lỗi mạng
        if(loader) loader.style.display = 'none';
        switchLabel.style.display = 'inline-block';
        checkbox.checked = !checkbox.checked;
    } 
}