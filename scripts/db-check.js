#!/usr/bin/env node
const { CORE_TABLES, checkDatabase } = require('../src/database/initDatabase');

checkDatabase()
  .then(({ databasePath, exists, tableCounts }) => {
    console.log(`Database path: ${databasePath}`);

    if (!exists) {
      console.log('Database does not exist. Run npm run db:init first.');
      process.exitCode = 1;
      return;
    }

    console.log('Core table row counts:');
    CORE_TABLES.forEach((tableName) => {
      console.log(`- ${tableName}: ${tableCounts[tableName]}`);
    });
  })
  .catch((error) => {
    console.error('Failed to check database.');
    console.error(error);
    process.exit(1);
  });
