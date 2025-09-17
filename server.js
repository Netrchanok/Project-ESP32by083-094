
require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const { formatInTimeZone } = require('date-fns-tz');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // ใช้ Port จาก Render หรือ 3000 ถ้าเป็น local

const MONGO_URI = process.env.MONGO_URI;

// เพิ่มการตรวจสอบ MONGO_URI
if (!MONGO_URI || !MONGO_URI.startsWith('mongodb')) {
  console.error("❌ Fatal: MONGO_URI is not defined in your .env file.");
  console.error("   Please ensure your .env file contains a valid MONGO_URI that starts with 'mongodb://' or 'mongodb+srv://'");
  process.exit(1); // ออกจากโปรแกรมทันทีถ้าไม่มี MONGO_URI
}
const client = new MongoClient(MONGO_URI);
let db; // สร้างตัวแปร db ไว้ข้างนอก

// ฟังก์ชันสำหรับเชื่อมต่อฐานข้อมูล
async function connectDB() {
  if (db) return; // ถ้าเชื่อมต่อแล้วให้ออกจากฟังก์ชัน
  try {
    await client.connect();
    db = client.db("weatherdb");
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB", err);
    process.exit(1); // ออกจากโปรแกรมถ้าต่อ DB ไม่ได้
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // เพิ่ม middleware สำหรับอ่าน JSON body ที่ ESP32 ส่งมา

app.get('/', async (req, res) => {
  try {
    const searchQuery = req.query.q || '';
    const collection = db.collection("records");

    // สร้างเงื่อนไขการค้นหา
    const matchStage = {};
    if (searchQuery) {
      // ใช้ regex เพื่อค้นหาแบบ case-insensitive และ partial match
      matchStage.city = { $regex: searchQuery, $options: 'i' };
    }

    // 1. ดึงข้อมูลล่าสุดของแต่ละจังหวัด
    // 2. จัดกลุ่มตามภาค (region)
    const pipeline = [
      { $match: matchStage }, // เพิ่ม stage สำหรับการกรองข้อมูล
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$city",
          doc: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { city: 1 } },
      {
        $group: {
          _id: "$region",
          provinces: { $push: "$$ROOT" }
        }
      },
      { $sort: { _id: 1 } } // เรียงตามชื่อภาค
    ];

    const regions = await collection.aggregate(pipeline).toArray();

    // แปลงเวลา timestamp ของแต่ละจังหวัดให้เป็นเวลาไทย
    const timeZone = 'Asia/Bangkok';
    const formatString = 'd/M/yyyy HH:mm:ss';

    regions.forEach(region => {
      region.provinces.forEach(province => {
        province.formattedTimestamp = formatInTimeZone(province.timestamp, timeZone, formatString);
      });
    });

    // --- เพิ่มส่วนนี้: ดึงข้อมูลจาก Sensor ---
    const sensorCollection = db.collection('sensors'); // ใช้ db object ที่เชื่อมต่อไว้แล้ว
    const sensorData = await sensorCollection
      .find({})
      .sort({ timestamp: -1 }) // ดึงข้อมูลล่าสุดก่อน
      .limit(5) // ดึงข้อมูล 5 รายการล่าสุด
      .toArray();

    // แปลงเวลา timestamp ของ sensor
    sensorData.forEach(sensor => {
      sensor.formattedTimestamp = formatInTimeZone(sensor.timestamp, timeZone, formatString);
    });
    // --- จบส่วนที่เพิ่ม ---

    res.render('index', { regions, sensorData, query: searchQuery, locale: 'th-TH' });
  } catch (err) {
    console.error(err);
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});

// --- เพิ่ม Route ใหม่สำหรับรับข้อมูลจาก ESP32 ---
app.post('/api/sensor', async (req, res) => {
  try {
    // ดึงค่า temperature และ humidity จาก request body ที่ ESP32 ส่งมา
    const { temperature, humidity } = req.body;

    // ตรวจสอบว่ามีข้อมูลส่งมาหรือไม่
    if (temperature === undefined || humidity === undefined) {
      return res.status(400).json({ message: 'Bad Request: Missing temperature or humidity.' });
    }

    const sensorCollection = db.collection('sensors'); // แก้ไขให้ใช้ db object ที่เชื่อมต่อกับ 'weatherdb' อยู่แล้ว

    // สร้าง document ที่จะบันทึกลง DB
    const newSensorRecord = {
      temperature: Number(temperature),
      humidity: Number(humidity),
      timestamp: new Date() // ใช้เวลาปัจจุบันของ Server
    };

    await sensorCollection.insertOne(newSensorRecord);
    console.log('✅ Received and saved sensor data:', newSensorRecord);
    res.status(201).json({ message: 'Sensor data saved successfully.' });
  } catch (err) {
    console.error('❌ Error saving sensor data:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// เชื่อมต่อ DB ก่อนแล้วค่อยเปิดเซิร์ฟเวอร์
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
  });
});
