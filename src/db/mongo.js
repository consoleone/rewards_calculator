const { MongoClient } = require("mongodb");

const config = {
  url: process.env.MONGODB_URI,
  dbName: process.env.DATABASE,
};
const client = new MongoClient(config.url);
async function getDb() {
  await client.connect();

  const db = client.db(config.dbName);
  return db;
}

module.exports = { getDb, client };
