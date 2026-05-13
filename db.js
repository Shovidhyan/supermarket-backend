require('dotenv').config();

const sql = require('mssql');

const isAzure = process.env.DB_MODE === 'azure';

const config = isAzure
  ? {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,

      options: {
        encrypt: true,
        trustServerCertificate: true
      }
    }
  : {
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,

      options: {
        trustServerCertificate: true,
        encrypt: false
      }
    };

const connectDB = async () => {
  try {
    await sql.connect(config);

    console.log(
      `✅ Connected to ${
        isAzure ? 'Azure SQL Database' : 'Local SQL Database'
      }: ${config.database}`
    );
  } catch (err) {
    console.error('❌ Database Connection Failed:', err);
    process.exit(1);
  }
};

module.exports = { sql, connectDB };