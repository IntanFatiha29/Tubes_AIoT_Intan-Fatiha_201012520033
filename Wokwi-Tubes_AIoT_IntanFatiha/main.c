#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

#include "driver/gpio.h"
#include "driver/adc.h"

#include "esp_rom_sys.h"
#include "esp_timer.h"

#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"

#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASS ""

#define FIREBASE_URL "https://aiot-smartcurtain-default-rtdb.asia-southeast1.firebasedatabase.app"

#define LDR_ADC_CHANNEL ADC1_CHANNEL_6
#define DHT_PIN GPIO_NUM_4

#define STEP_PIN GPIO_NUM_26
#define DIR_PIN GPIO_NUM_27

#define RED_LED GPIO_NUM_18
#define GREEN_LED GPIO_NUM_19
#define BLUE_LED GPIO_NUM_21

static EventGroupHandle_t wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0

int current_angle = 0;
float last_temperature = 28.0;
float last_humidity = 60.0;

/* WIFI */
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  }

  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
    esp_wifi_connect();
    printf("WiFi reconnect...\n");
  }

  if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    printf("WiFi connected\n");
    xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
  }
}

void wifi_init(void) {
  nvs_flash_init();

  wifi_event_group = xEventGroupCreate();

  esp_netif_init();
  esp_event_loop_create_default();
  esp_netif_create_default_wifi_sta();

  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  esp_wifi_init(&cfg);

  esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                      &wifi_event_handler, NULL, NULL);
  esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                      &wifi_event_handler, NULL, NULL);

  wifi_config_t wifi_config = {
    .sta = {
      .ssid = WIFI_SSID,
      .password = WIFI_PASS
    }
  };

  esp_wifi_set_mode(WIFI_MODE_STA);
  esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
  esp_wifi_start();

  printf("Connecting to WiFi...\n");

  xEventGroupWaitBits(
    wifi_event_group,
    WIFI_CONNECTED_BIT,
    false,
    true,
    portMAX_DELAY
  );
}

/* DHT22 */
int wait_for_level(gpio_num_t pin, int level, int timeout_us) {
  int64_t start = esp_timer_get_time();

  while (gpio_get_level(pin) != level) {
    if ((esp_timer_get_time() - start) > timeout_us) return -1;
  }

  return esp_timer_get_time() - start;
}

int read_dht22(float *temperature, float *humidity) {
  uint8_t data[5] = {0};

  gpio_set_direction(DHT_PIN, GPIO_MODE_OUTPUT);
  gpio_set_level(DHT_PIN, 0);
  esp_rom_delay_us(1000);

  gpio_set_level(DHT_PIN, 1);
  esp_rom_delay_us(40);

  gpio_set_direction(DHT_PIN, GPIO_MODE_INPUT);

  if (wait_for_level(DHT_PIN, 0, 100) < 0) return -1;
  if (wait_for_level(DHT_PIN, 1, 100) < 0) return -1;
  if (wait_for_level(DHT_PIN, 0, 100) < 0) return -1;

  for (int i = 0; i < 40; i++) {
    if (wait_for_level(DHT_PIN, 1, 100) < 0) return -1;

    int64_t start = esp_timer_get_time();

    if (wait_for_level(DHT_PIN, 0, 100) < 0) return -1;

    int duration = esp_timer_get_time() - start;

    data[i / 8] <<= 1;

    if (duration > 40) {
      data[i / 8] |= 1;
    }
  }

  uint8_t checksum = data[0] + data[1] + data[2] + data[3];

  if (checksum != data[4]) return -2;

  uint16_t raw_humidity = (data[0] << 8) | data[1];
  uint16_t raw_temperature = (data[2] << 8) | data[3];

  *humidity = raw_humidity / 10.0;

  if (raw_temperature & 0x8000) {
    raw_temperature &= 0x7FFF;
    *temperature = -(raw_temperature / 10.0);
  } else {
    *temperature = raw_temperature / 10.0;
  }

  return 0;
}

/* SENSOR */
float adc_to_lux(int adc)
{
    return (4095.0f - adc) * 4000.0f / 4095.0f;
}

void update_rgb(int angle) {

  // OFF semua dulu (common anode)
  gpio_set_level(RED_LED, 1);
  gpio_set_level(GREEN_LED, 1);
  gpio_set_level(BLUE_LED, 1);

  if (angle == 0) {
    // MERAH
    gpio_set_level(RED_LED, 0);
  }
  else if (angle == 45) {
    // KUNING = MERAH + HIJAU
    gpio_set_level(RED_LED, 0);
    gpio_set_level(GREEN_LED, 0);
  }
  else if (angle == 90) {
    // BIRU
    gpio_set_level(BLUE_LED, 0);
  }
}

/* MOTOR */
void step_motor(int steps, int direction) {
  printf("Stepper bergerak %d langkah\n", steps);

  gpio_set_level(DIR_PIN, direction);

  for (int i = 0; i < steps; i++) {
    gpio_set_level(STEP_PIN, 1);
    esp_rom_delay_us(800);

    gpio_set_level(STEP_PIN, 0);
    esp_rom_delay_us(800);
  }
}

void move_to_angle(int target_angle) {
  int diff = target_angle - current_angle;

  if (diff == 0) {
    printf("Motor tetap di posisi %d derajat\n", current_angle);
    return;
  }

  int steps = abs(diff) * 200 / 360;
  int direction = (diff > 0) ? 1 : 0;

  printf("Motor bergerak dari %d derajat ke %d derajat\n",
         current_angle, target_angle);

  step_motor(steps, direction);

  current_angle = target_angle;
}

/* FIREBASE: KIRIM SENSOR SAJA */
void send_sensor_to_firebase(float lux, float temperature, float humidity) {
  char json_data[256];

  snprintf(
    json_data,
    sizeof(json_data),
    "{"
      "\"lux\":%.1f,"
      "\"temperature\":%.1f,"
      "\"humidity\":%.1f"
    "}",
    lux,
    temperature,
    humidity
  );

  char url[256];
  snprintf(url, sizeof(url), "%s/sensor.json", FIREBASE_URL);

  esp_http_client_config_t config = {
    .url = url,
    .method = HTTP_METHOD_PUT,
    .timeout_ms = 5000,
    .crt_bundle_attach = esp_crt_bundle_attach
  };

  esp_http_client_handle_t client = esp_http_client_init(&config);

  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_post_field(client, json_data, strlen(json_data));

  esp_err_t err = esp_http_client_perform(client);

  printf("ERR = %s\n", esp_err_to_name(err));
  printf("HTTP Status = %d\n",
       esp_http_client_get_status_code(client));

  if (err == ESP_OK) {
    printf("Data sensor terkirim ke Firebase\n");
    printf("HTTP Status = %d\n", esp_http_client_get_status_code(client));
  } else {
    printf("Gagal kirim sensor ke Firebase: %s\n", esp_err_to_name(err));
  }

  esp_http_client_cleanup(client);
}

/* MAIN */
void app_main() {
  printf("\n===== AIoT Smart Curtain System =====\n");

  wifi_init();

  gpio_set_direction(STEP_PIN, GPIO_MODE_OUTPUT);
  gpio_set_direction(DIR_PIN, GPIO_MODE_OUTPUT);

  gpio_set_direction(RED_LED, GPIO_MODE_OUTPUT);
  gpio_set_direction(GREEN_LED, GPIO_MODE_OUTPUT);
  gpio_set_direction(BLUE_LED, GPIO_MODE_OUTPUT);

  gpio_set_level(RED_LED, 0);
  gpio_set_level(GREEN_LED, 1);
  gpio_set_level(BLUE_LED, 1);

vTaskDelay(pdMS_TO_TICKS(3000));

  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(LDR_ADC_CHANNEL, ADC_ATTEN_DB_12);

  while (1) {
    int adc_value = adc1_get_raw(LDR_ADC_CHANNEL);
    printf("ADC mentah : %d\n", adc_value);
    float lux = adc_to_lux(adc_value);

    float temperature = 0;
    float humidity = 0;

    int dht_status = read_dht22(&temperature, &humidity);

    if (dht_status == 0) {
      last_temperature = temperature;
      last_humidity = humidity;
    } else {
      printf("\nDHT22 gagal dibaca, memakai data terakhir | Error: %d | Lux: %.1f lx\n",
             dht_status, lux);

      temperature = last_temperature;
      humidity = last_humidity;
    }

    printf("\n==============================\n");
    printf("DATA SENSOR SAAT INI\n");
    printf("==============================\n");
    printf("ADC mentah   : %d\n", adc_value);
    printf("Lux          : %.1f lx\n", lux);
    printf("Suhu         : %.1f C\n", temperature);
    printf("Kelembapan   : %.1f %%\n", humidity);

    printf("\nKIRIM SENSOR KE FIREBASE\n");
    printf("==============================\n");

    send_sensor_to_firebase(lux, temperature, humidity);

    printf("\nAMBIL HASIL ML DARI FIREBASE\n");
printf("==============================\n");

int firebase_position;

if (lux > 3000)
    firebase_position = 0;
else if (lux >= 1000)
    firebase_position = 45;
else
    firebase_position = 90;

printf("firebase_position = %d\n",
       firebase_position);

if (firebase_position == 0 || firebase_position == 45 || firebase_position == 90) {

    printf("Posisi Tirai dari ML Firebase: %d derajat\n",
           firebase_position);

    update_rgb(firebase_position);
    move_to_angle(firebase_position);
}
else {

    printf("Posisi tirai belum tersedia dari Firebase\n");
}

    printf("==============================\n\n");

    vTaskDelay(pdMS_TO_TICKS(10000));
  }
}