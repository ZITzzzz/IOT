const express = require('express');
const router = express.Router();
const iotController = require('../controllers/iotController');
const { NAME_TO_CODE } = require('../config/deviceMap');

module.exports = (mqttClient, io) => {
    // Route Dashboard (Chỉ cần API Control, còn hiển thị dùng Socket)
    router.get('/dashboard', (req, res) => {
        // Dashboard giờ dùng Socket là chính, nhưng để API này nếu FE cũ cần gọi lấy data snapshot
        iotController.getSensorHistory(req, res); 
    });
    
    // API Control cần truyền mqttClient và io vào controller
    router.post('/control', (req, res) => iotController.controlDevice(req, res, mqttClient, io));
    
    // API Lấy thiết bị kèm trạng thái hiện tại (derived từ action_history)
    router.get('/devices', async (req, res) => {
        const db = require('../config/db');
        const [rows] = await db.execute(`
            SELECT d.name,
                IFNULL(
                    (SELECT ah.status FROM action_history ah
                     WHERE ah.device_id = d.id AND ah.status IN ('ON', 'OFF')
                     ORDER BY ah.created_at DESC LIMIT 1),
                    'OFF'
                ) AS current_status
            FROM devices d
        `);
        res.json(rows.map(r => ({ ...r, code: NAME_TO_CODE[r.name] || r.name })));
    });

    // Route History & Sensor (Giữ nguyên cho việc tìm kiếm)
    router.get('/sensor-history', iotController.getSensorHistory);
    router.get('/action-history', iotController.getActionHistory);

    return router;
};