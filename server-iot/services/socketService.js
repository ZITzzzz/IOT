const db = require('../config/db');
const { NAME_TO_CODE } = require('../config/deviceMap');

const SENSOR_PIVOT_SQL = `
    SELECT
        MAX(CASE WHEN s.name = 'Cảm biến Nhiệt độ' THEN sd.value END) AS temperature,
        MAX(CASE WHEN s.name = 'Cảm biến Độ ẩm'    THEN sd.value END) AS humidity,
        MAX(CASE WHEN s.name = 'Cảm biến Ánh sáng'  THEN sd.value END) AS light,
        sd.created_at
    FROM sensor_data sd
    JOIN sensor s ON sd.sensor_id = s.id
`;

const initSocket = (io) => {
    io.on('connection', async (socket) => {
        console.log(`🔌 Client connected: ${socket.id}`);

        const lastSensorTime = socket.handshake.query.lastSensorTime || null;

        try {
            let sensors = [];

            if (lastSensorTime) {
                // Lấy dữ liệu từ lastSensorTime đến hiện tại (lấp gap sau F5)
                const [gapRows] = await db.execute(
                    SENSOR_PIVOT_SQL +
                    `WHERE sd.created_at > ?
                     GROUP BY sd.created_at
                     ORDER BY sd.created_at DESC
                     LIMIT 20`,
                    [lastSensorTime]
                );
                sensors = gapRows.reverse();
                console.log(`📦 Gap fill: ${sensors.length} bản ghi kể từ ${lastSensorTime}`);
            }

            // Nếu không có lastSensorTime hoặc không có dữ liệu mới → fallback 20 bản ghi gần nhất
            if (sensors.length === 0) {
                const [fallback] = await db.execute(
                    SENSOR_PIVOT_SQL +
                    `GROUP BY sd.created_at
                     ORDER BY sd.created_at DESC
                     LIMIT 20`
                );
                sensors = fallback.reverse();
            }

            // Lấy trạng thái hiện tại của thiết bị (status ON hoặc OFF, bỏ qua LOADING)
            const [devRows] = await db.execute(`
                SELECT d.name,
                    IFNULL(
                        (SELECT CASE
                                    WHEN ah.action IN ('ON', 'TURN ON')  THEN 'ON'
                                    ELSE 'OFF'
                                END
                         FROM action_history ah
                         WHERE ah.device_id = d.id
                         ORDER BY ah.created_at DESC LIMIT 1),
                        'OFF'
                    ) AS current_status
                FROM devices d
            `);

            // Thêm code (tiếng Anh) để frontend dùng tìm element theo ID
            const devices = devRows.map(d => ({ ...d, code: NAME_TO_CODE[d.name] || d.name }));

            socket.emit('init_data', { sensors, devices });
        } catch (e) {
            console.error("Socket Init Error:", e);
        }

        socket.on('disconnect', () => {
            console.log(`❌ Client disconnected: ${socket.id}`);
        });
    });
};

module.exports = initSocket;
