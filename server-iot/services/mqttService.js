const mqtt = require('mqtt');
const db = require('../config/db');
const { CODE_TO_NAME, NAME_TO_CODE } = require('../config/deviceMap');
require('dotenv').config();

const initMqtt = (io) => {
    const client = mqtt.connect(process.env.MQTT_BROKER,{
        username: 'TongQuangViet',
        password: '123456'
    }

    );
    const TOPIC = process.env.TOPIC_GENERAL;

    // Map từ key MQTT (tiếng Anh) sang tên trong bảng `sensor` (tiếng Việt)
    const SENSOR_NAME_MAP = {
        temperature: 'Cảm biến Nhiệt độ',
        humidity:    'Cảm biến Độ ẩm',
        light:       'Cảm biến Ánh sáng',
    };

    // Cache sensor IDs từ bảng `sensor`: { 'Cảm biến Nhiệt độ': 1, ... }
    let sensorIds = {};

    const loadSensorIds = async () => {
        const [rows] = await db.execute('SELECT id, name FROM sensor');
        rows.forEach(r => { sensorIds[r.name] = r.id; });
        console.log('📋 Sensor IDs loaded:', sensorIds);
    };

    client.on('connect', async () => {
        console.log('✅ MQTT Connected');
        await loadSensorIds();
        client.subscribe(TOPIC);
    });

    client.on('message', async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());

            // 1. Xử lý Dữ liệu Cảm biến — insert 3 rows cùng timestamp vào sensor_data (EAV)
            if (payload.type === 'sensor_data') {
                const idTemp  = sensorIds[SENSOR_NAME_MAP.temperature];
                const idHum   = sensorIds[SENSOR_NAME_MAP.humidity];
                const idLight = sensorIds[SENSOR_NAME_MAP.light];
                if (!idTemp || !idHum || !idLight) {
                    console.error('❌ Sensor IDs chưa được load. Kiểm tra bảng `sensor` có đủ 3 dòng: Cảm biến Nhiệt độ, Cảm biến Độ ẩm, Cảm biến Ánh sáng.');
                    return;
                }
                const now = new Date();
                await db.execute(
                    'INSERT INTO sensor_data (sensor_id, value, created_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
                    [
                        idTemp,  payload.temp,  now,
                        idHum,   payload.hum,   now,
                        idLight, payload.light, now
                    ]
                );

                io.emit('new_sensor', {
                    temperature: payload.temp,
                    humidity: payload.hum,
                    light: payload.light,
                    created_at: now
                });
                console.log("📡 New Data -> Emitted to Client");
            }

            // 2. ESP32 vừa kết nối lại, yêu cầu khôi phục trạng thái cuối
            if (payload.type === 'request_state') {
                const [devRows] = await db.execute(`
                    SELECT d.name,
                        IFNULL(
                            (SELECT ah.status FROM action_history ah
                             WHERE ah.device_id = d.id AND ah.status IN ('ON', 'OFF')
                             ORDER BY ah.created_at DESC LIMIT 1),
                            'OFF'
                        ) AS last_status
                    FROM devices d
                `);
                // Gửi 1 message duy nhất chứa tất cả trạng thái — tránh gọi callback nhiều lần
                const stateMsg = { type: 'restore_state' };
                devRows.forEach(dev => {
                    const code = NAME_TO_CODE[dev.name] || dev.name; // "Van Tưới" → "pump"
                    stateMsg[code] = dev.last_status;
                    console.log(`🔄 Khôi phục: ${code} → ${dev.last_status}`);
                });
                client.publish(TOPIC, JSON.stringify(stateMsg));
            }

            // 3. Xử lý phản hồi từ ESP32 (bỏ qua waiting)
            if (payload.type === 'device_status_feedback' && payload.status !== 'waiting') {
                const deviceCode = payload.device_code;
                const action = payload.action;
                const finalStatus = payload.status === 'success'
                    ? action
                    : (action === 'ON' ? 'OFF' : 'ON');

                console.log(`✅ ESP32 Confirmed: ${deviceCode} -> ${action} (${payload.status}) → DB status: ${finalStatus}`);

                // Emit socket TRƯỚC — không để DB block UI
                io.emit('device_update', { code: deviceCode, status: action, result: payload.status });

                // Lưu DB sau (lỗi DB không ảnh hưởng UI)
                try {
                    const dbName = CODE_TO_NAME[deviceCode];
                    if (dbName) {
                        const [dev] = await db.execute('SELECT id FROM devices WHERE name = ?', [dbName]);
                        if (dev.length > 0) {
                            const dbAction = action === 'ON' ? 'TURN ON' : 'TURN OFF';
                            const [result] = await db.execute(
                                `UPDATE action_history SET status = ?
                                 WHERE id = (
                                     SELECT id FROM (
                                         SELECT id FROM action_history
                                         WHERE device_id = ? AND action = ? AND status = 'LOADING'
                                         ORDER BY created_at DESC LIMIT 1
                                     ) AS t
                                 )`,
                                [finalStatus, dev[0].id, dbAction]
                            );
                            if (result.affectedRows === 0) {
                                await db.execute(
                                    'INSERT INTO action_history (device_id, action, status) VALUES (?, ?, ?)',
                                    [dev[0].id, dbAction, finalStatus]
                                );
                            }
                        }
                    }
                } catch (dbErr) {
                    console.error('DB update error (device feedback):', dbErr.message);
                }
            }

        } catch (e) {
            console.error("MQTT Message Error:", e);
        }
    });

    return client;
};

module.exports = initMqtt;