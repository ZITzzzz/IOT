const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const initMqtt = require('./services/mqttService');
const initSocket = require('./services/socketService');
const apiRoutes = require('./routes/api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Cấu hình Socket.io
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middleware
app.use(cors());
app.use(express.json());

// 1. Khởi động MQTT (Truyền io vào để nó có thể emit data)
const mqttClient = initMqtt(io);

// 2. Khởi động Socket Service (Xử lý connection, init_data)
initSocket(io);

// 3. Khởi tạo Routes (Truyền mqttClient và io vào để API control dùng)
app.use('/api', apiRoutes(mqttClient, io));

// Chạy Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`🔌 Socket.io ready`);
});