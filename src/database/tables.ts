import { pool } from './connection';

// データベースのテーブルを作成する関数
export async function createTables() {
    const connection = await pool.getConnection();
    try {
        await connection.query(
            `CREATE TABLE IF NOT EXISTS servers (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                discord_server_id VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        await connection.query(
            `CREATE TABLE IF NOT EXISTS channels (
                id VARCHAR(255) PRIMARY KEY,
                server_id BIGINT NOT NULL,
                name VARCHAR(255) NOT NULL,
                parent_channel_id VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_channel_id) REFERENCES channels(id) ON DELETE CASCADE
            )`
        );
        await connection.query(
            `CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(255) NOT NULL,
                discord_user_id VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        await connection.query(
            `CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                channel_id VARCHAR(255) NOT NULL,
                user_id BIGINT NOT NULL,
                content TEXT,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX (created_at)
            )`
        );
        console.log('データベースのテーブルを確認・作成しました。');
    } catch (error) {
        console.error('テーブル作成中にエラーが発生しました:', error);
    } finally {
        connection.release();
    }
} 