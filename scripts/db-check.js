#!/usr/bin/env node

const { checkDatabase } = require('../src/database/initDatabase');

checkDatabase()
  .then(({ databasePath, tableCounts }) => {
    console.log(`数据库路径：${databasePath}`);
    console.log('核心表数据数量：');

    tableCounts.forEach(({ tableName, count }) => {
      console.log(`${tableName}: ${count}`);
    });
  })
  .catch((error) => {
    console.error('数据库检查失败：');
    console.error(error);
    process.exit(1);
  });
