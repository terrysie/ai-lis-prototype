#!/usr/bin/env node

const { initializeDatabase } = require('../src/database/initDatabase');

initializeDatabase()
  .then(({ databasePath, created, message }) => {
    console.log(message);
    console.log(`数据库路径：${databasePath}`);
    console.log(`是否新建：${created ? '是' : '否'}`);
  })
  .catch((error) => {
    console.error('数据库初始化失败：');
    console.error(error);
    process.exit(1);
  });
