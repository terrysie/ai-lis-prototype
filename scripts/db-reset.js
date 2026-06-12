#!/usr/bin/env node

const { resetDatabase } = require('../src/database/initDatabase');

resetDatabase()
  .then(({ databasePath, message }) => {
    console.log(message);
    console.log(`数据库路径：${databasePath}`);
  })
  .catch((error) => {
    console.error('数据库重置失败：');
    console.error(error);
    process.exit(1);
  });
