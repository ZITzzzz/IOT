#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <BH1750.h>
#include "DHT.h"

// ================= CẤU HÌNH WIFI & MQTT =================
const char* ssid = "Test";        
const char* password = "12345678";       

// ĐỊA CHỈ IP)
const char* mqtt_server = "192.168.137.1";      
const int mqtt_port = 2102;

const char* topic_general = "iot/system/general"; 

// ================= CẤU HÌNH CHÂN =================
#define LED_PUMP    5   // LED 1: Van Tưới
#define LED_HEATER  3   // LED 2: Máy Sưởi
#define LED_MIST    1   // LED 3: Phun Sương

#define DHTPIN      0   // Chân DHT
#define DHTTYPE     DHT11

#define SDA_PIN     8   // Chân SDA BH1750
#define SCL_PIN     9   // Chân SCL BH1750

// ================= KHỞI TẠO ĐỐI TƯỢNG =================
BH1750 lightMeter;
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 2000; // 2 giây gửi cảm biến 1 lần
// Thêm các biến này bên dưới các khai báo cũ
bool isBlinking = false;
unsigned long lastBlinkTime = 0;
int blinkStep = 0;
const long blinkInterval = 500; // Tốc độ nhấp nháy 0.5 giây
// ================= HÀM XỬ LÝ NHẬN LỆNH (CALLBACK) UPDATED =================
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) message += (char)payload[i];
  
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, message);
  if (error) return;

  const char* type = doc["type"];
  if (type != NULL && strcmp(type, "device_status_feedback") == 0) return;

  // Khôi phục trạng thái sau khi reconnect — 1 message, set trực tiếp không feedback
  if (type != NULL && strcmp(type, "restore_state") == 0) {
    const char* p = doc["pump"];
    const char* h = doc["heater"];
    const char* m = doc["mist"];
    if (p) digitalWrite(LED_PUMP,   strcmp(p, "ON") == 0 ? HIGH : LOW);
    if (h) digitalWrite(LED_HEATER, strcmp(h, "ON") == 0 ? HIGH : LOW);
    if (m) digitalWrite(LED_MIST,   strcmp(m, "ON") == 0 ? HIGH : LOW);
    Serial.println("✅ Trạng thái thiết bị đã khôi phục");
    return;
  }

  if (type != NULL && strcmp(type, "control_cmd") == 0) {
    const char* device_code = doc["device_code"];
    const char* action = doc["status"];
    bool isOn = (strcmp(action, "ON") == 0);

    // PHẢN HỒI WAITING
    StaticJsonDocument<256> resp;
    resp["type"] = "device_status_feedback";
    resp["device_code"] = device_code;
    resp["status"] = "waiting";
    resp["action"] = action;
    char buffer[256];
    serializeJson(resp, buffer);
    client.publish(topic_general, buffer);

    bool handled = false;

    // --- LOGIC XỬ LÝ GHI ĐÈ ---
    
    // 1. Nếu điều khiển "Tất cả đèn"
    if (strcmp(device_code, "all_lights") == 0) {
      isBlinking = false; 
      int state = isOn ? HIGH : LOW;
      digitalWrite(LED_PUMP, state);
      digitalWrite(LED_HEATER, state);
      digitalWrite(LED_MIST, state);
      handled = true;
    } 
    // 2. Nếu điều khiển "Chế độ nhấp nháy"
    else if (strcmp(device_code, "blink_mode") == 0) {
      isBlinking = isOn;
      if (!isBlinking) { 
        digitalWrite(LED_PUMP, LOW);
        digitalWrite(LED_HEATER, LOW);
        digitalWrite(LED_MIST, LOW);
      }
      handled = true;
    }
    // 3. Nếu điều khiển "Từng đèn lẻ"
    else {
      int pin = -1;
      if (strcmp(device_code, "pump") == 0) pin = LED_PUMP;
      else if (strcmp(device_code, "heater") == 0) pin = LED_HEATER;
      else if (strcmp(device_code, "mist") == 0) pin = LED_MIST;

      if (pin != -1) {
        // Nếu nhận lệnh OFF cho 1 đèn, cũng tự động dừng chế độ nhấp nháy
        if (!isOn) isBlinking = false; 
        
        digitalWrite(pin, isOn ? HIGH : LOW);
        handled = true;
      }
    }

    // PHẢN HỒI SUCCESS
    resp.clear();
    resp["type"] = "device_status_feedback";
    resp["device_code"] = device_code;
    resp["status"] = handled ? "success" : "error";
    resp["action"] = action;
    serializeJson(resp, buffer);
    client.publish(topic_general, buffer);
  }
}
// ================= HÀM KẾT NỐI LẠI MQTT =================
void reconnect() {
  while (!client.connected()) {
    Serial.print("Đang kết nối MQTT...");
    // Tạo ID ngẫu nhiên để không bị kick
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), "TongQuangViet", "123456")) {
      Serial.println("Đã kết nối!");
      client.subscribe(topic_general);
      // Yêu cầu server gửi lại trạng thái cuối của tất cả thiết bị
      client.publish(topic_general, "{\"type\":\"request_state\"}");
      Serial.println("📤 Gửi request_state");
    } else {
      Serial.print("Lỗi, rc=");
      Serial.print(client.state());
      Serial.println(" thử lại sau 5s");
      delay(5000);
    }
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  // Cấu hình LED
  pinMode(LED_PUMP, OUTPUT);
  pinMode(LED_HEATER, OUTPUT);
  pinMode(LED_MIST, OUTPUT);
  
  // Mặc định tắt hết
  digitalWrite(LED_PUMP, LOW);
  digitalWrite(LED_HEATER, LOW);
  digitalWrite(LED_MIST, LOW);

  // Cấu hình Cảm biến
  Wire.begin(SDA_PIN, SCL_PIN); // Khởi tạo I2C với chân 8, 9
  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println("❌ Không tìm thấy BH1750!");
  } else {
    Serial.println("✅ BH1750 OK");
  }
  
  dht.begin();

  // Kết nối WiFi
  Serial.print("Đang kết nối WiFi: ");
  Serial.println(ssid);
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  WiFi.disconnect(true);
  delay(1000);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected. IP: ");
  Serial.println(WiFi.localIP());

  // Cấu hình MQTT
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback); // Gán hàm nhận lệnh
}

// ================= LOOP =================
void loop() {
  // 1. Kiểm tra kết nối MQTT
  if (!client.connected()) {
    reconnect();
  }
  client.loop(); // Duy trì kết nối

  // 2. Gửi dữ liệu cảm biến (Non-blocking delay)
  unsigned long now = millis();
  if (isBlinking) {
    if (now - lastBlinkTime > blinkInterval) {
      lastBlinkTime = now;
      // Tắt tất cả trước khi chuyển bước
      digitalWrite(LED_PUMP, LOW);
      digitalWrite(LED_HEATER, LOW);
      digitalWrite(LED_MIST, LOW);

      if (blinkStep == 0) digitalWrite(LED_PUMP, HIGH);
      else if (blinkStep == 1) digitalWrite(LED_HEATER, HIGH);
      else if (blinkStep == 2) digitalWrite(LED_MIST, HIGH);

      blinkStep = (blinkStep + 1) % 3; // Chạy vòng tròn 0 -> 1 -> 2
    }
  }
  if (now - lastMsg > interval) {
    lastMsg = now;

    float h = dht.readHumidity();
    float t = dht.readTemperature();
    float lux = lightMeter.readLightLevel();

    // Kiểm tra lỗi cảm biến
    if (isnan(h) || isnan(t)) {
      Serial.println("❌ Lỗi đọc DHT11!");
      return; 
    }

    // Đóng gói JSON
    // {"type":"sensor_data", "temp":30.5, "hum":70, "light":200}
    StaticJsonDocument<256> doc;
    doc["type"] = "sensor_data";
    doc["temp"] = t;
    doc["hum"] = h;
    doc["light"] = lux;

    char buffer[256];
    serializeJson(doc, buffer);

    // Gửi đi
    client.publish(topic_general, buffer);
    Serial.print("📡 Gửi cảm biến: ");
    Serial.println(buffer);
  }
}
