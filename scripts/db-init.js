#!/usr/bin/env node
const { initializeDatabase } = require('../src/database/initDatabase');

initializeDatabase()
  .then(({ databasePath, created }) => {
    console.log(created ? 'Database initialized.' : 'Database already exists. Seed data was not re-imported.');
    console.log(`Database path: ${databasePath}`);
  })
  .catch((error) => {
    console.error('Failed to initialize database.');
    console.error(error);
    process.exit(1);
  });
