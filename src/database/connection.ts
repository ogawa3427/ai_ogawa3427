import mysql from 'mysql2/promise';
import { getConfig } from '../config';

// MySQL接続プールを作成
const config = getConfig();
export const pool = mysql.createPool({
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}); 