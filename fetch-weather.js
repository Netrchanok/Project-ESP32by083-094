require('dotenv').config();
const axios = require('axios');
const { MongoClient } = require('mongodb');
const thaiProvinces = require('./provinces.js');

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

async function fetchAndStoreWeather() {
  if (!OPENWEATHER_API_KEY || !MONGO_URI) {
    console.error('❌ Missing required environment variables: OPENWEATHER_API_KEY or MONGO_URI');
    return;
  }

  const client = new MongoClient(MONGO_URI);
  let successfulFetches = 0;

  try {fetchAndStoreWeather
    await client.connect();
    console.log('✅ Connected to MongoDB');
    const db = client.db('weatherdb');
    const collection = db.collection('records');

    for (const province of thaiProvinces) {
      const { name, name_th, lat, lon, region } = province;
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=th`;

      try {
        const response = await axios.get(url);
        const data = response.data;

        const weatherRecord = {
          city: name_th,
          city_en: name,
          region: region,
          temp: data.main.temp,
          humidity: data.main.humidity,
          weather: data.weather[0].description,
          icon: data.weather[0].icon,
          timestamp: new Date(),
        };

        await collection.insertOne(weatherRecord);
        console.log(`🌤️  Successfully fetched and stored weather for ${name_th}`);
        successfulFetches++;
      } catch (apiError) {
        console.error(`❌ Failed to fetch weather for ${name_th}: ${apiError.message}`);
      }
    }
  } catch (dbError) {
    console.error('❌ Database operation failed:', dbError);
  } finally {
    await client.close();
    console.log('✅ MongoDB connection closed.');
    console.log(`\n✨ Done! Successfully stored data for ${successfulFetches}/${thaiProvinces.length} locations.`);
  }
}

fetchAndStoreWeather();


