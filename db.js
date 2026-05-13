require('dotenv').config();

const isAzure = process.env.DB_MODE === 'azure';

const sql = isAzure
  ? require('mssql')
  : require('mssql/msnodesqlv8');

const config = isAzure
  ? {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,

    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate:
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    }
  }
  : {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    driver: 'msnodesqlv8',

    options: {
      trustedConnection: true,
      trustServerCertificate:
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      encrypt: process.env.DB_ENCRYPT === 'true'
    }
  };

const connectDB = async () => {
  try {
    const pool = await sql.connect(config);

    console.log(
      `✅ Connected to ${isAzure ? 'Azure SQL Database' : 'Local SQL Database'
      }: ${config.database}`
    );

    return pool;
  } catch (err) {
    console.error('❌ Database Connection Failed:', err);
    process.exit(1);
  }
};

module.exports = { sql, connectDB };