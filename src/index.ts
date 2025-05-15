import { Client, Events, GatewayIntentBits, ChannelType, Collection, Message, TextChannel, ThreadChannel, ApplicationCommandType, ChatInputCommandInteraction, GuildBasedChannel } from 'discord.js';
import * as configFile from '../config.json';
// import * as fs from 'fs'; // fsは不要になったのでコメントアウト
// import * as path from 'path'; // pathは不要になったのでコメントアウト
import mysql from 'mysql2/promise';

// 環境設定
const env = process.env.NODE_ENV || 'dev';

// TypeScript用の型定義
type EnvType = 'dev' | 'meta';
type ConfigType = {
    token: string;
    dev: {
        'sv-id': string;
        mysql: {
            host: string;
            port: string;
            user: string;
            password: string;
            database: string;
        }
    };
    meta: {
        'sv-id': string;
        mysql: {
            host: string;
            port: string;
            user: string;
            password: string;
            database: string;
        }
    };
};

// 型安全にする
const typedEnv = env as EnvType;
const typedConfig = configFile as ConfigType;

const config = {
    token: typedConfig.token,
    guildId: typedConfig[typedEnv]["sv-id"],
    mysql: typedConfig[typedEnv].mysql
};

// MySQL接続プールを作成
const pool = mysql.createPool({
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// データベースのテーブルを作成する関数
async function createTables() {
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
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

interface ServerData { // このインターフェースはもう使用しない可能性が高いですが、一旦残します
    serverName: string;
    channels: ChannelData[];
}

interface ChannelData { // このインターフェースはもう使用しない可能性が高いですが、一旦残します
    name: string;
    id: string;
    messages: MessageData[];
    threads: ThreadData[];
}

interface ThreadData { // このインターフェースはもう使用しない可能性が高いですが、一旦残します
    name: string;
    id: string;
    messages: MessageData[];
}

interface MessageData { // このインターフェースはもう使用しない可能性が高いですが、一旦残します
    author: string;
    content: string;
    id: string;
    createdAt: Date;
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ] 
});

// メイン処理を関数化
async function fetchMessages(guild: any, isDifferential: boolean = false): Promise<string> {
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
    
    const textChannels = guild.channels.cache.filter((channel: GuildBasedChannel) => 
        channel.type === ChannelType.GuildText
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

// スラッシュコマンドの登録
client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    await createTables(); // 起動時にテーブル作成処理を呼び出す
    
    try {
        const commands = [
            {
                name: 'fetch',
                description: 'メッセージを取得します',
                type: ApplicationCommandType.ChatInput,
                options: [
                    {
                        name: 'type',
                        description: '取得タイプ',
                        type: 3, // STRING
                        required: true,
                        choices: [
                            {
                                name: '全件取得',
                                value: 'full'
                            },
                            {
                                name: '差分取得',
                                value: 'diff'
                            }
                        ]
                    }
                ]
            }
        ];

        // グローバル登録（全サーバー、時間かかる）
        // await client.application?.commands.set(commands);

        // 特定サーバー限定の場合（即時反映）
        await client.application?.commands.set(commands, config.guildId);

        console.log('スラッシュコマンドを登録しました！');
    } catch (error) {
        console.error('スラッシュコマンドの登録に失敗しました:', error);
    }
});

// スラッシュコマンドのハンドリング
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'fetch') {
        await interaction.deferReply();
        
        try {
            const type = interaction.options.getString('type', true);
            const isDifferential = type === 'diff';
            
            const result = await fetchMessages(interaction.guild, isDifferential);
            await interaction.editReply(result);
        } catch (error) {
            console.error('エラーが発生しました:', error);
            await interaction.editReply('処理中にエラーが発生しました。');
        }
    }
});

async function getChannelMessages(channel: TextChannel | ThreadChannel, afterDate?: Date): Promise<Collection<string, Message>> {
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

async function getChannelThreads(channel: TextChannel): Promise<ThreadChannel[]> {
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

async function getThreadMessages(thread: ThreadChannel, afterDate?: Date): Promise<Collection<string, Message>> {
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
        
        // allMessages.forEach((message: Message) => { // DB保存するのでここでは不要
        //     console.log(`- ${message.author.tag}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
        // });
        
        return allMessages;
    } catch (error) {
        console.error(`スレッド「${thread.name}」のメッセージ取得中にエラー:`, error);
        return new Collection<string, Message>();
    }
}
// pingコマンドを登録
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    }
});

client.login(config.token);
