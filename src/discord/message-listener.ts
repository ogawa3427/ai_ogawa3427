import { Events, Message } from 'discord.js';
import { client } from './client';
import { pool } from '../database';

// メッセージが作成されたときのイベントリスナーを設定
export function setupMessageListener() {
    client.on(Events.MessageCreate, async (message: Message) => {
        // BOTのメッセージは無視
        if (message.author.bot) return;

        // サーバーIDがない場合は無視（DMなど）
        if (!message.guild) return;

        try {
            await saveMessageToDB(message);
            console.log(`メッセージを保存しました: ${message.id}`);
        } catch (error) {
            console.error('メッセージの保存中にエラーが発生しました:', error);
        }
    });
}

// メッセージをDBに保存する関数
async function saveMessageToDB(message: Message): Promise<void> {
    const connection = await pool.getConnection();
    
    try {
        // サーバー情報の取得または作成
        let serverDbId: number;
        const [existingServer]: any = await connection.query(
            'SELECT id FROM servers WHERE discord_server_id = ?', 
            [message.guild!.id]
        );
        
        if (existingServer.length > 0) {
            serverDbId = existingServer[0].id;
        } else {
            const [result]: any = await connection.query(
                'INSERT INTO servers (name, discord_server_id) VALUES (?, ?)',
                [message.guild!.name, message.guild!.id]
            );
            serverDbId = result.insertId;
        }
        
        // チャンネル情報の取得または作成
        // チャンネル名の取得
        let channelName = 'unknown-channel';
        if ('name' in message.channel && message.channel.name !== null) {
            channelName = message.channel.name;
        }
        
        // スレッドの場合は親チャンネルIDを含める
        if (message.channel.isThread() && message.channel.parentId) {
            // 親チャンネルが存在するか確認し、なければ先に追加
            const [existingParentChannel]: any = await connection.query(
                'SELECT id FROM channels WHERE id = ?', 
                [message.channel.parentId]
            );
            
            if (existingParentChannel.length === 0) {
                // 親チャンネルの情報を取得
                let parentChannelName = 'unknown-parent-channel';
                const parentChannel = message.guild?.channels.cache.get(message.channel.parentId);
                if (parentChannel && 'name' in parentChannel && parentChannel.name) {
                    parentChannelName = parentChannel.name;
                }
                
                // 親チャンネルを先に追加
                await connection.query(
                    'INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?)',
                    [message.channel.parentId, serverDbId, parentChannelName]
                );
            }
            
            // その後でスレッドチャンネルを追加
            await connection.query(
                'INSERT INTO channels (id, server_id, name, parent_channel_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), parent_channel_id = VALUES(parent_channel_id)',
                [message.channel.id, serverDbId, channelName, message.channel.parentId]
            );
        } else {
            // 通常のチャンネルの場合は親チャンネルIDなし
            await connection.query(
                'INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
                [message.channel.id, serverDbId, channelName]
            );
        }
        
        // ユーザー情報の取得または作成
        let userDbId: number;
        const [existingUser]: any = await connection.query(
            'SELECT id FROM users WHERE discord_user_id = ?', 
            [message.author.id]
        );
        
        if (existingUser.length > 0) {
            userDbId = existingUser[0].id;
            // ユーザー名が変更されていれば更新
            if (existingUser[0].username !== message.author.tag) {
                await connection.query(
                    'UPDATE users SET username = ? WHERE id = ?', 
                    [message.author.tag, userDbId]
                );
            }
        } else {
            const [insertUserResult]: any = await connection.query(
                'INSERT INTO users (username, discord_user_id) VALUES (?, ?)',
                [message.author.tag, message.author.id]
            );
            userDbId = insertUserResult.insertId;
        }
        
        // メッセージが既に存在するか確認
        const [existingMessage]: any = await connection.query(
            'SELECT id FROM messages WHERE id = ?', 
            [message.id]
        );
        
        // 既存のメッセージがない場合のみ挿入
        if (existingMessage.length === 0) {
            await connection.query(
                'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
                [message.id, message.channel.id, userDbId, message.content, message.createdAt]
            );
        }
    } finally {
        connection.release();
    }
} 