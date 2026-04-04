const db = require('../config/db');
const { CODE_TO_NAME } = require('../config/deviceMap');

// API 1: Lấy lịch sử cảm biến (Có Lọc & Phân trang) - Phục vụ sensor.js
exports.getSensorHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const startDate = req.query.start_date;
        const endDate   = req.query.end_date;
        const minTemp   = req.query.min_temp;
        const maxTemp   = req.query.max_temp;
        const minHum    = req.query.min_hum;
        const maxHum    = req.query.max_hum;
        const minLight  = req.query.min_light;
        const maxLight  = req.query.max_light;
        const search    = req.query.search;

        let whereClause = 'WHERE 1=1';
        let params = [];

        if (startDate) { whereClause += ' AND sd.created_at >= ?'; params.push(startDate); }
        if (endDate)   { whereClause += ' AND sd.created_at <= ?'; params.push(endDate); }

        // HAVING lọc theo giá trị cảm biến (alias từ SELECT)
        const havingConds = [];
        const havingParams = [];
        if (minTemp)  { havingConds.push('temperature >= ?'); havingParams.push(minTemp); }
        if (maxTemp)  { havingConds.push('temperature <= ?'); havingParams.push(maxTemp); }
        if (minHum)   { havingConds.push('humidity >= ?');    havingParams.push(minHum); }
        if (maxHum)   { havingConds.push('humidity <= ?');    havingParams.push(maxHum); }
        if (minLight) { havingConds.push('light >= ?');       havingParams.push(minLight); }
        if (maxLight) { havingConds.push('light <= ?');       havingParams.push(maxLight); }
        // Tìm kiếm tự do: khớp bất kỳ cột nào chứa chuỗi
        if (search) {
            const like = `%${search}%`;
            havingConds.push(`(
                CAST(temperature AS CHAR) LIKE ?
                OR CAST(humidity   AS CHAR) LIKE ?
                OR CAST(light      AS CHAR) LIKE ?
                OR DATE_FORMAT(sd.created_at, '%H:%i:%s %d/%m/%Y') LIKE ?
                OR DATE_FORMAT(sd.created_at, '%e/%c/%Y') LIKE ?
                OR DATE_FORMAT(sd.created_at, '%H:%i:%s %e/%c/%Y') LIKE ?
            )`);
            havingParams.push(like, like, like, like, like, like);
        }
        const havingClause = havingConds.length ? 'HAVING ' + havingConds.join(' AND ') : '';

        // Pivot EAV: mỗi reading = 3 rows có cùng created_at
        const sqlData = `
            SELECT
                MIN(sd.id) AS id,
                MAX(CASE WHEN s.name = 'Cảm biến Nhiệt độ' THEN sd.value END) AS temperature,
                MAX(CASE WHEN s.name = 'Cảm biến Độ ẩm'    THEN sd.value END) AS humidity,
                MAX(CASE WHEN s.name = 'Cảm biến Ánh sáng'  THEN sd.value END) AS light,
                sd.created_at
            FROM sensor_data sd
            JOIN sensor s ON sd.sensor_id = s.id
            ${whereClause}
            GROUP BY sd.created_at
            ${havingClause}
            ORDER BY sd.created_at DESC
            LIMIT ? OFFSET ?
        `;
        const [rows] = await db.execute(sqlData, [...params, ...havingParams, limit.toString(), offset.toString()]);

        // Count dùng subquery để tính đúng khi có HAVING
        const sqlCount = `
            SELECT COUNT(*) AS total FROM (
                SELECT sd.created_at,
                    MAX(CASE WHEN s.name = 'Cảm biến Nhiệt độ' THEN sd.value END) AS temperature,
                    MAX(CASE WHEN s.name = 'Cảm biến Độ ẩm'    THEN sd.value END) AS humidity,
                    MAX(CASE WHEN s.name = 'Cảm biến Ánh sáng'  THEN sd.value END) AS light
                FROM sensor_data sd
                JOIN sensor s ON sd.sensor_id = s.id
                ${whereClause}
                GROUP BY sd.created_at
                ${havingClause}
            ) AS sub
        `;
        const [countRes] = await db.execute(sqlCount, [...params, ...havingParams]);
        const total = countRes[0].total;

        res.json({
            data: rows,
            pagination: {
                page, limit, total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// API 2: Lấy lịch sử hành động (Có Lọc & Phân trang) - Phục vụ history.js
exports.getActionHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { device_id, action, start_date, end_date } = req.query;

        let sqlWhere = 'WHERE 1=1';
        let params = [];

        if (device_id && device_id !== 'all') {
            sqlWhere += ' AND h.device_id = ?';
            params.push(device_id);
        }
        if (action && action !== 'all') {
            sqlWhere += ' AND h.action = ?';
            params.push(action);
        }
        if (start_date) {
            sqlWhere += ' AND h.created_at >= ?';
            params.push(start_date);
        }
        if (end_date) {
            sqlWhere += ' AND h.created_at <= ?';
            params.push(end_date);
        }

        const sqlData = `
            SELECT h.id, d.name as device_name, h.action, h.status, h.created_at 
            FROM action_history h 
            JOIN devices d ON h.device_id = d.id 
            ${sqlWhere} 
            ORDER BY h.created_at DESC LIMIT ? OFFSET ?`;
            
        const paramsData = [...params, limit.toString(), offset.toString()];
        const [rows] = await db.execute(sqlData, paramsData);

        const sqlCount = `SELECT COUNT(*) as total FROM action_history h ${sqlWhere}`;
        const [countRes] = await db.execute(sqlCount, params);

        res.json({
            data: rows,
            pagination: {
                page, limit, total: countRes[0].total,
                totalPages: Math.ceil(countRes[0].total / limit)
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// API 3: Điều khiển thiết bị (POST) - Phục vụ dashboard.js toggleDevice
exports.controlDevice = async (req, res, mqttClient) => {
    const { code, action } = req.body;
    try {
        // Publish MQTT trước — không để DB block lệnh điều khiển
        const cmd = JSON.stringify({ type: 'control_cmd', device_code: code, status: action });
        mqttClient.publish(process.env.TOPIC_GENERAL, cmd);

        res.json({ success: true, message: "Command sent to MQTT" });

        // Lưu LOADING vào DB sau (lỗi DB không ảnh hưởng đến điều khiển)
        const dbName = CODE_TO_NAME[code];
        if (dbName) {
            const [dev] = await db.execute('SELECT id FROM devices WHERE name = ?', [dbName]);
            if (dev.length > 0) {
                await db.execute(
                    'INSERT INTO action_history (device_id, action, status) VALUES (?, ?, ?)',
                    [dev[0].id, action, 'LOADING']
                );
            }
        }
    } catch (e) {
        // Chỉ trả lỗi nếu publish MQTT thất bại (DB lỗi sau khi res.json thì bỏ qua)
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else console.error('DB insert LOADING error:', e.message);
    }
};