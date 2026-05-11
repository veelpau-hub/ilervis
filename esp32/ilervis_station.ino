/*
 * Ilervis — Estació Meteorològica ESP32
 * Hardware: ESP32 NodeMCU + BME280 (I2C, GPIO21 SDA, GPIO22 SCL)
 *
 * Dependències (Library Manager):
 *   - Adafruit BME280 Library
 *   - Adafruit Unified Sensor
 *   - ArduinoJson
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// ── Configuració ──────────────────────────────────────────────────────────────

const char* WIFI_SSID     = "EL_TEU_WIFI";
const char* WIFI_PASSWORD = "LA_TEVA_CONTRASSENYA";
const char* SERVER_URL    = "https://la-teva-app.up.railway.app/api/station/data";
const char* STATION_KEY   = "";                       // X-Station-Key (si buit, s'ignora)
const char* STATION_ID    = "ilervis-lleida-01";
const int   READ_INTERVAL = 60;                       // segons entre lectures

// ── Hardware ──────────────────────────────────────────────────────────────────

#define LED_BUILTIN  2
#define BME_SDA      21
#define BME_SCL      22

Adafruit_BME280 bme;
bool bme_ok = false;

// ── Prototips ─────────────────────────────────────────────────────────────────

void setupWifi();
void reconnectWifi();
bool sendReading(float temp, float hum, float pres);
void blinkLed(int times, int ms = 80);

// ── Setup ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[Ilervis] Iniciant estació meteorològica...");

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Wire.begin(BME_SDA, BME_SCL);
  bme_ok = bme.begin(0x76);
  if (!bme_ok) {
    Serial.println("[BME280] ERROR — sensor no trobat a 0x76");
    // Prova amb 0x77
    bme_ok = bme.begin(0x77);
    if (!bme_ok) {
      Serial.println("[BME280] ERROR — sensor no trobat a 0x77 tampoc");
    }
  }
  if (bme_ok) {
    Serial.println("[BME280] OK");
    bme.setSampling(
      Adafruit_BME280::MODE_FORCED,
      Adafruit_BME280::SAMPLING_X1,   // temperatura
      Adafruit_BME280::SAMPLING_X1,   // pressió
      Adafruit_BME280::SAMPLING_X1,   // humitat
      Adafruit_BME280::FILTER_OFF
    );
  }

  setupWifi();
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
  reconnectWifi();

  if (!bme_ok) {
    Serial.println("[BME280] Sensor no disponible — esperant...");
    delay(READ_INTERVAL * 1000UL);
    return;
  }

  bme.takeForcedMeasurement();
  float temperature = bme.readTemperature();
  float humidity    = bme.readHumidity();
  float pressure    = bme.readPressure() / 100.0F;   // Pa → hPa

  Serial.printf("[sensor] T=%.1f°C  H=%.1f%%  P=%.2fhPa\n",
                temperature, humidity, pressure);

  if (isnan(temperature) || isnan(humidity) || isnan(pressure)) {
    Serial.println("[sensor] Lectura invàlida — reintentant en 10s");
    delay(10000);
    return;
  }

  bool ok = sendReading(temperature, humidity, pressure);
  if (ok) {
    blinkLed(2);
  } else {
    blinkLed(5, 50);
  }

  delay(READ_INTERVAL * 1000UL);
}

// ── WiFi ──────────────────────────────────────────────────────────────────────

void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connectant");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connectat — IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] No s'ha pogut connectar — continuant sense xarxa");
  }
}

void reconnectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println("[WiFi] Desconnectat — reintentant...");
  WiFi.reconnect();
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Reconnectat");
  }
}

// ── HTTP POST ─────────────────────────────────────────────────────────────────

bool sendReading(float temp, float hum, float pres) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Sense connexió WiFi — dada descartada");
    return false;
  }

  StaticJsonDocument<200> doc;
  doc["temperature"] = round(temp * 10) / 10.0;
  doc["humidity"]    = round(hum  * 10) / 10.0;
  doc["pressure"]    = round(pres * 100) / 100.0;
  doc["timestamp"]   = (unsigned long)(millis() / 1000);  // uptime; reemplaça amb NTP si vols UTC real
  doc["station_id"]  = STATION_ID;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  if (strlen(STATION_KEY) > 0) {
    http.addHeader("X-Station-Key", STATION_KEY);
  }
  http.setTimeout(10000);

  int code = http.POST(body);
  Serial.printf("[HTTP] POST → %d\n", code);
  http.end();

  return (code == 200);
}

// ── LED ───────────────────────────────────────────────────────────────────────

void blinkLed(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(ms);
    digitalWrite(LED_BUILTIN, LOW);
    delay(ms);
  }
}
