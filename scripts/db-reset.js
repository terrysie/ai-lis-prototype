#!/usr/bin/env node
const { resetDatabase } = require('../src/database/initDatabase');

resetDatabase()
  .then(({ databasePath }) => {
    console.log('Database reset complete.');
    console.log(`Database path: ${databasePath}`);
  })
  .catch((error) => {
    console.error('Failed to reset database.');
    console.error(error);
    process.exit(1);
  });
