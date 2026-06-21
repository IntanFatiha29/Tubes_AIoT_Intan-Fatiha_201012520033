console.log("🚀 script.js berhasil dijalankan");

// Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getDatabase,
    ref,
    onValue,
    query,
    limitToLast,
    push,
    set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyAhXMV1F3Z8x_LM74reAn77aLDHUefjyMs",
    authDomain: "aiot-smartcurtain.firebaseapp.com",
    databaseURL: "https://aiot-smartcurtain-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "aiot-smartcurtain",
    storageBucket: "aiot-smartcurtain.firebasestorage.app",
    messagingSenderId: "648518196959",
    appId: "1:648518196959:web:14a13cbb29b19af1fad36a"
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

console.log("✅ Firebase Connected");

// Deklarasi Chart Instances
let luxChart, tempChart, humChart;

// Fungsi Helper untuk Membuat Gradien
function createChartGradient(ctx, colorStart, colorEnd) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, colorStart);
    gradient.addColorStop(1, colorEnd);
    return gradient;
}

// Inisialisasi Grafik Chart.js
function initCharts() {
    const ctxLux = document.getElementById('luxChart').getContext('2d');
    const ctxTemp = document.getElementById('tempChart').getContext('2d');
    const ctxHum = document.getElementById('humChart').getContext('2d');

    const commonOptions = (yLabel, borderHex, fillHexStart) => ({
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: yLabel,
                data: [],
                borderColor: borderHex,
                backgroundColor: function(context) {
                    const chart = context.chart;
                    const {ctx, chartArea} = chart;
                    if (!chartArea) return null;
                    return createChartGradient(ctx, fillHexStart, 'rgba(255, 255, 255, 0)');
                },
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: borderHex,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#800f2f',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    titleFont: { family: 'Poppins', size: 11, weight: '600' },
                    bodyFont: { family: 'Poppins', size: 11 },
                    padding: 10,
                    borderRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: { family: 'Poppins', size: 9 },
                        color: '#8c6e74'
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 77, 109, 0.08)'
                    },
                    ticks: {
                        font: { family: 'Poppins', size: 9 },
                        color: '#8c6e74'
                    }
                }
            }
        }
    });

    luxChart = new Chart(ctxLux, commonOptions('Intensitas (lx)', '#ff4d6d', 'rgba(255, 77, 109, 0.25)'));
    tempChart = new Chart(ctxTemp, commonOptions('Suhu (°C)', '#ff758f', 'rgba(255, 117, 143, 0.25)'));
    humChart = new Chart(ctxHum, commonOptions('Kelembapan (%)', '#800f2f', 'rgba(128, 15, 47, 0.25)'));
}

// Format timestamp ke HH:mm:ss
function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "";
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Ambil timestamp dari Firebase push ID (opsional fallback)
function getTimestampFromPushId(id) {
    const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
    if (!id || id.length < 8) return Date.now();
    let time = 0;
    for (let i = 0; i < 8; i++) {
        const c = id.charAt(i);
        const val = PUSH_CHARS.indexOf(c);
        if (val === -1) return Date.now();
        time = (time * 64) + val;
    }
    return time;
}

// Jalankan inisialisasi grafik
initCharts();

// Baca data realtime sensor secara spesifik
onValue(ref(db, 'sensor'), (snapshot) => {
    const sensor = snapshot.val();
    if (!sensor) return;
    document.getElementById("lux").innerText = sensor.lux ?? 0;
    document.getElementById("temp").innerText = sensor.temperature ?? 0;
    document.getElementById("hum").innerText = sensor.humidity ?? 0;
    console.log("⚡ Data Sensor Diperbarui");
});

// Baca data realtime prediksi secara spesifik
onValue(ref(db, 'prediction'), (snapshot) => {
    const prediction = snapshot.val();
    if (!prediction) return;
    document.getElementById("lux_next").innerText = prediction.lux_next ?? 0;
    document.getElementById("temp_next").innerText = prediction.temperature_next ?? 0;
    document.getElementById("hum_next").innerText = prediction.humidity_next ?? 0;
    console.log("🔮 Data Prediksi Diperbarui");
});

// Baca data realtime tirai secara spesifik
onValue(ref(db, 'curtain'), (snapshot) => {
    const curtain = snapshot.val();
    if (!curtain) return;
    const position = curtain.position ?? 0;
    document.getElementById("curtain").innerText = position + "°";

    let status = "";
    if (position <= 0) {
        status = "Tertutup Rapat";
    } else if (position >= 90) {
        status = "Terbuka Penuh";
    } else {
        status = "Setengah Terbuka";
    }

    document.getElementById("curtain-status-label").innerText = status;
    document.documentElement.style.setProperty('--curtain-angle', position);
    console.log("🪟 Status Tirai Diperbarui");
});

// Baca data realtime historis (20 data terakhir)
const historyRef = query(ref(db, 'history'), limitToLast(20));
onValue(historyRef, (snapshot) => {
    const historyData = snapshot.val();
    if (!historyData || Object.keys(historyData).length < 5) {
        console.log("⚠️ Data historis kosong atau terlalu sedikit, membuat data simulasi...");
        populateMockHistory(db);
        return;
    }

    // Urutkan data secara kronologis (terlama ke terbaru)
    const sortedEntries = Object.entries(historyData).map(([key, val]) => ({
        id: key,
        ...val
    })).sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeA - timeB || a.id.localeCompare(b.id);
    });

    const labels = [];
    const luxValues = [];
    const tempValues = [];
    const humValues = [];

    sortedEntries.forEach(entry => {
        let timestamp = entry.timestamp;
        if (!timestamp) {
            try {
                timestamp = getTimestampFromPushId(entry.id);
            } catch (e) {
                timestamp = Date.now();
            }
        }
        
        labels.push(formatTime(timestamp));
        luxValues.push(entry.lux ?? 0);
        tempValues.push(entry.temperature ?? entry.temp ?? 0);
        humValues.push(entry.humidity ?? entry.hum ?? 0);
    });

    // Update datasets
    luxChart.data.labels = labels;
    luxChart.data.datasets[0].data = luxValues;
    luxChart.update();

    tempChart.data.labels = labels;
    tempChart.data.datasets[0].data = tempValues;
    tempChart.update();

    humChart.data.labels = labels;
    humChart.data.datasets[0].data = humValues;
    humChart.update();

    console.log("📈 Grafik historis diperbarui dengan", sortedEntries.length, "data");
});

async function getBojongsoangWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=-6.973" +
    "&longitude=107.630" +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" +
    "&timezone=Asia%2FBangkok";

  try {
    const response = await fetch(url);
    const data = await response.json();

    document.getElementById("weather-temp").innerText =
      data.current.temperature_2m;

    document.getElementById("weather-hum").innerText =
      data.current.relative_humidity_2m;

    document.getElementById("weather-wind").innerText =
      data.current.wind_speed_10m;

    console.log("Cuaca Bojongsoang:", data.current);

  } catch (error) {
    console.log("Gagal mengambil data cuaca:", error);
  }
}

getBojongsoangWeather();

setInterval(getBojongsoangWeather, 600000);

// Fungsi untuk membuat data historis simulasi jika kosong
function populateMockHistory(db) {
    const historyRef = ref(db, 'history');
    const now = Date.now();
    const mockData = {};

    // Buat 15 titik data historis dengan interval 5 menit ke belakang
    for (let i = 14; i >= 0; i--) {
        const time = now - (i * 5 * 60 * 1000);
        // Fluktuasi nilai sensor yang realistis
        const lux = Math.round(800 + Math.sin(i * 0.5) * 100 + Math.random() * 30);
        const temp = parseFloat((25 + Math.cos(i * 0.5) * 3 + Math.random() * 0.8).toFixed(1));
        const hum = parseFloat((60 + Math.sin(i * 0.3) * 5 + Math.random() * 2).toFixed(1));

        const key = `mock_${time}`;
        mockData[key] = {
            timestamp: time,
            lux: lux,
            temperature: temp,
            humidity: hum
        };
    }

    set(historyRef, mockData)
        .then(() => {
            console.log("✅ Data historis simulasi berhasil dibuat!");
        })
        .catch((error) => {
            console.error("❌ Gagal membuat data historis simulasi:", error);
        });
}

// Tambah data sensor saat ini ke history setiap 30 detik untuk demo realtime
setInterval(() => {
    const luxVal = parseFloat(document.getElementById("lux").innerText) || 0;
    const tempVal = parseFloat(document.getElementById("temp").innerText) || 0;
    const humVal = parseFloat(document.getElementById("hum").innerText) || 0;

    // Pastikan data sensor valid sebelum dimasukkan ke history
    if (luxVal > 0 || tempVal > 0 || humVal > 0) {
        const historyRef = ref(db, 'history');
        push(historyRef, {
            timestamp: Date.now(),
            lux: luxVal,
            temperature: tempVal,
            humidity: humVal
        }).then(() => {
            console.log("📝 Data sensor saat ini ditambahkan ke history");
        }).catch((error) => {
            console.error("❌ Gagal menambahkan ke history:", error);
        });
    }
}, 30000); // 30 detik