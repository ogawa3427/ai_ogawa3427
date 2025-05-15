import { Collection, Message, TextChannel, ThreadChannel } from 'discord.js';
import { pool } from '../database';

// メッセージ取得処理のメイン関数
export async function fetchMessages(guild: any, isDifferential: boolean = false): Promise<string> {
    if (!guild) {
        console.log('サーバーが見つかりません');
        return 'サーバーが見つかりません';
    }
    
    console.log(`サーバー「${guild.name}」の情報を取得します...`);
    
    let afterDate: Date | undefined = undefined;

    if (isDifferential) {
        const connection = await pool.getConnection();
        try {
            const [rows]: any = await connection.query('SELECT MAX(m.created_at) as latest_date FROM messages m JOIN channels c ON m.channel_id = c.id JOIN servers s ON c.server_id = s.id WHERE s.discord_server_id = ?', [guild.id]);
            if (rows && rows.length > 0 && rows[0].latest_date) {
                afterDate = new Date(rows[0].latest_date);
            }
        } catch (error) {
            console.error('差分取得のための最新メッセージ日時取得エラー:', error);
        } finally {
            connection.release();
        }
    }
    
    if (afterDate) {
        console.log(`${afterDate.toISOString()} 以降のメッセージを取得します。`);
    } else {
        console.log('全てのメッセージを取得します。');
    }

    let serverDbId: number | undefined;
    const serverConnection = await pool.getConnection();
    try {
        const [existingServer]: any = await serverConnection.query('SELECT id FROM servers WHERE discord_server_id = ?', [guild.id]);
        if (existingServer.length > 0) {
            serverDbId = existingServer[0].id;
            await serverConnection.query(
                'UPDATE servers SET name = ? WHERE id = ?',
                [guild.name, serverDbId]
            );
        } else {
            const [result]: any = await serverConnection.query(
                'INSERT INTO servers (name, discord_server_id) VALUES (?, ?)',
                [guild.name, guild.id]
            );
            serverDbId = result.insertId;
        }
        console.log(`サーバー「${guild.name}」の情報をDBに保存/更新しました。`);
    } catch (error) {
        console.error(`サーバー「${guild.name}」のDB保存中にエラー:`, error);
        return 'サーバー情報の保存中にエラーが発生しました。';
    } finally {
        serverConnection.release();
    }

    if (!serverDbId) {
        console.error(`サーバー「${guild.name}」のDB IDが取得できませんでした。`);
        return 'サーバーIDの取得に失敗しました。';
    }
    
    const textChannels = guild.channels.cache.filter((channel: any) => 
        channel.type === 0 // ChannelType.GuildText
    );
    
    console.log(`テキストチャンネル数: ${textChannels.size}`);
    
    for (const channel of textChannels.values()) {
        console.log(`\n===== チャンネル: ${channel.name} =====`);
        
        const channelConnection = await pool.getConnection();
        try {
            await channelConnection.query(
                'INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
                [channel.id, serverDbId, channel.name]
            );
            console.log(`チャンネル「${channel.name}」の情報をDBに保存しました。`);
        } catch (error) {
            console.error(`チャンネル「${channel.name}」のDB保存中にエラー:`, error);
            continue;
        } finally {
            channelConnection.release();
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const messages = await getChannelMessages(channel, afterDate);

        const messageConnection = await pool.getConnection();
        try {
            for (const msg of messages.values()) {
                let userDbId: number | undefined;
                const [existingUser]: any = await messageConnection.query('SELECT id FROM users WHERE discord_user_id = ?', [msg.author.id]);

                if (existingUser.length > 0) {
                    userDbId = existingUser[0].id;
                    if (existingUser[0].username !== msg.author.tag) {
                        await messageConnection.query('UPDATE users SET username = ? WHERE id = ?', [msg.author.tag, userDbId]);
                    }
                } else {
                    const [insertUserResult]: any = await messageConnection.query(
                        'INSERT INTO users (username, discord_user_id) VALUES (?, ?)',
                        [msg.author.tag, msg.author.id]
                    );
                    userDbId = insertUserResult.insertId;
                }

                if (userDbId) {
                    await messageConnection.query(
                        'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content), created_at = VALUES(created_at)',
                        [msg.id, channel.id, userDbId, msg.content, msg.createdAt]
                    );
                } else {
                    console.error(`ユーザーID ${msg.author.id} のDB IDが取得できませんでした。`);
                }
            }
            console.log(`チャンネル「${channel.name}」のメッセージ ${messages.size} 件をDBに保存しました。`);
        } catch (error) {
            console.error(`チャンネル「${channel.name}」のメッセージDB保存中にエラー:`, error);
        } finally {
            messageConnection.release();
        }
        
        const threads = await getChannelThreads(channel);
        
        for (const thread of threads) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const threadChannelConnection = await pool.getConnection();
            try {
                await threadChannelConnection.query(
                    'INSERT INTO channels (id, server_id, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
                    [thread.id, serverDbId, thread.name]
                );
                console.log(`スレッド「${thread.name}」の情報をDBに保存しました。`);

                const threadMessages = await getThreadMessages(thread, afterDate);
                
                for (const msg of threadMessages.values()) {
                    let userDbId: number | undefined;
                    const [existingUser]: any = await threadChannelConnection.query('SELECT id FROM users WHERE discord_user_id = ?', [msg.author.id]);
                    if (existingUser.length > 0) {
                        userDbId = existingUser[0].id;
                        if (existingUser[0].username !== msg.author.tag) {
                             await threadChannelConnection.query('UPDATE users SET username = ? WHERE id = ?', [msg.author.tag, userDbId]);
                        }
                    } else {
                        const [insertUserResult]: any = await threadChannelConnection.query(
                            'INSERT INTO users (username, discord_user_id) VALUES (?, ?)',
                            [msg.author.tag, msg.author.id]
                        );
                        userDbId = insertUserResult.insertId;
                    }

                    if (userDbId) {
                        await threadChannelConnection.query(
                            'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content), created_at = VALUES(created_at)',
                            [msg.id, thread.id, userDbId, msg.content, msg.createdAt]
                        );
                    } else {
                         console.error(`ユーザーID ${msg.author.id} のDB IDが取得できませんでした。(スレッドメッセージ保存時)`);
                    }
                }
                 console.log(`スレッド「${thread.name}」のメッセージ ${threadMessages.size} 件をDBに保存しました。`);
            } catch (error) {
                console.error(`スレッド「${thread.name}」のDB保存中にエラー:`, error);
            } finally {
                threadChannelConnection.release();
            }
        }
    }
    
    return '処理が完了しました！データベースに保存しました。';
}

// チャンネルのメッセージを取得する関数
export async function getChannelMessages(channel: TextChannel | ThreadChannel, afterDate?: Date): Promise<Collection<string, Message>> {
    try {
        let allMessages = new Collection<string, Message>();
        let lastId: string | undefined;

        while (true) {
            const options: { limit: number; before?: string } = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            // 日付でフィルタリング
            const filteredMessages = afterDate 
                ? messages.filter(msg => msg.createdAt > afterDate)
                : messages;

            allMessages = allMessages.concat(filteredMessages);
            
            // 全てのメッセージが指定日時より古い場合は終了
            if (afterDate && messages.every(msg => msg.createdAt <= afterDate)) {
                break;
            }

            lastId = messages.last()?.id;
            
            console.log(`メッセージ取得中... 現在${allMessages.size}件`);
            
            if (messages.size < 100) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`合計メッセージ数: ${allMessages.size}`);
        return allMessages;
    } catch (error) {
        console.error(`チャンネル「${channel.name}」のメッセージ取得中にエラー:`, error);
        return new Collection<string, Message>();
    }
}

// チャンネルのスレッドを取得する関数
export async function getChannelThreads(channel: TextChannel): Promise<ThreadChannel[]> {
    try {
        const activeThreads = await channel.threads.fetchActive();
        const archivedThreads = await channel.threads.fetchArchived();
        
        const allThreads = [
            ...activeThreads.threads.values(), 
            ...archivedThreads.threads.values()
        ];
        
        console.log(`スレッド数: ${allThreads.length}`);
        
        allThreads.forEach(thread => {
            console.log(`- スレッド: ${thread.name} (ID: ${thread.id})`);
        });
        
        return allThreads;
    } catch (error) {
        console.error(`チャンネル「${channel.name}」のスレッド取得中にエラー:`, error);
        return [];
    }
}

// スレッドのメッセージを取得する関数
export async function getThreadMessages(thread: ThreadChannel, afterDate?: Date): Promise<Collection<string, Message>> {
    try {
        console.log(`\n----- スレッド: ${thread.name} -----`);
        let allMessages = new Collection<string, Message>();
        let lastId: string | undefined;

        while (true) {
            const options: { limit: number; before?: string } = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await thread.messages.fetch(options);
            if (messages.size === 0) break;

            // 日付でフィルタリング
            const filteredMessages = afterDate 
                ? messages.filter(msg => msg.createdAt > afterDate)
                : messages;

            allMessages = allMessages.concat(filteredMessages);
            
            // 全てのメッセージが指定日時より古い場合は終了 (差分取得時)
            if (afterDate && messages.every(msg => msg.createdAt <= afterDate) && filteredMessages.size === 0) {
                break;
            }

            lastId = messages.last()?.id;

            console.log(`メッセージ取得中... 現在${allMessages.size}件`);
            
            if (messages.size < 100) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`合計メッセージ数: ${allMessages.size}`);
        
        return allMessages;
    } catch (error) {
        console.error(`スレッド「${thread.name}」のメッセージ取得中にエラー:`, error);
        return new Collection<string, Message>();
    }
} 