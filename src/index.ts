import { Client, Events, GatewayIntentBits, ChannelType, Collection, Message, TextChannel, ThreadChannel, ApplicationCommandType, ChatInputCommandInteraction, GuildBasedChannel } from 'discord.js';
import * as config from '../config.json';
import * as fs from 'fs';
import * as path from 'path';

interface ServerData {
    serverName: string;
    channels: ChannelData[];
}

interface ChannelData {
    name: string;
    id: string;
    messages: MessageData[];
    threads: ThreadData[];
}

interface ThreadData {
    name: string;
    id: string;
    messages: MessageData[];
}

interface MessageData {
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

// 最新のJSONファイルを取得する関数
function getLatestJsonFile(): { filePath: string; data: ServerData } | null {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
        return null;
    }

    const files = fs.readdirSync(outputDir)
        .filter(file => file.startsWith('discord_data_') && file.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length === 0) {
        return null;
    }

    const latestFile = files[0];
    const filePath = path.join(outputDir, latestFile);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ServerData;
    return { filePath, data };
}

// メッセージの最終取得日時を取得
function getLatestMessageDate(data: ServerData): Date | undefined {
    let latestDate: Date | undefined = undefined;

    for (const channel of data.channels) {
        for (const message of channel.messages) {
            const messageDate = new Date(message.createdAt);
            if (!latestDate || messageDate > latestDate) {
                latestDate = messageDate;
            }
        }
        for (const thread of channel.threads) {
            for (const message of thread.messages) {
                const messageDate = new Date(message.createdAt);
                if (!latestDate || messageDate > latestDate) {
                    latestDate = messageDate;
                }
            }
        }
    }

    return latestDate;
}

// メイン処理を関数化
async function fetchMessages(guild: any, isDifferential: boolean = false): Promise<string> {
    if (!guild) {
        console.log('サーバーが見つかりません');
        return 'サーバーが見つかりません';
    }
    
    console.log(`サーバー「${guild.name}」の情報を取得します...`);
    
    // 最新のJSONファイルを取得
    const latestJson = getLatestJsonFile();
    const afterDate = isDifferential && latestJson ? getLatestMessageDate(latestJson.data) : undefined;
    
    if (afterDate) {
        console.log(`${afterDate.toISOString()} 以降のメッセージを取得します。`);
    } else {
        console.log('全てのメッセージを取得します。');
    }

    const serverData: ServerData = latestJson 
        ? latestJson.data
        : {
            serverName: guild.name,
            channels: []
        };
    
    const textChannels = guild.channels.cache.filter((channel: GuildBasedChannel) => 
        channel.type === ChannelType.GuildText
    );
    
    console.log(`テキストチャンネル数: ${textChannels.size}`);
    
    for (const channel of textChannels.values()) {
        console.log(`\n===== チャンネル: ${channel.name} =====`);
        
        const channelData: ChannelData = {
            name: channel.name,
            id: channel.id,
            messages: [],
            threads: []
        };
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const messages = await getChannelMessages(channel, afterDate);
        channelData.messages = messages.map(msg => ({
            author: msg.author.tag,
            content: msg.content,
            id: msg.id,
            createdAt: msg.createdAt
        }));
        
        const threads = await getChannelThreads(channel);
        
        for (const thread of threads) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const threadMessages = await getThreadMessages(thread);
            
            const threadData: ThreadData = {
                name: thread.name,
                id: thread.id,
                messages: threadMessages.map(msg => ({
                    author: msg.author.tag,
                    content: msg.content,
                    id: msg.id,
                    createdAt: msg.createdAt
                }))
            };
            
            channelData.threads.push(threadData);
        }
        
        serverData.channels.push(channelData);
    }
    
    // JSONファイルに書き出し
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // タイムスタンプを新しく設定してファイル保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `discord_data_${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(serverData, null, 2), 'utf8');
    console.log(`データをJSONファイルに保存しました: ${outputPath}`);

    return '処理が完了しました！';
}

// スラッシュコマンドの登録
client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    
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
        const guildId = config['test-sv-id'];
        await client.application?.commands.set(commands, guildId);

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

async function getThreadMessages(thread: ThreadChannel): Promise<Collection<string, Message>> {
    try {
        console.log(`\n----- スレッド: ${thread.name} -----`);
        let allMessages = new Collection<string, Message>();
        let lastId: string | undefined;

        while (true) {
            const options: { limit: number; before?: string } = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await thread.messages.fetch(options);
            if (messages.size === 0) break;

            allMessages = allMessages.concat(messages);
            lastId = messages.last()?.id;

            console.log(`メッセージ取得中... 現在${allMessages.size}件`);
            
            if (messages.size < 100) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`合計メッセージ数: ${allMessages.size}`);
        
        allMessages.forEach((message: Message) => {
            console.log(`- ${message.author.tag}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
        });
        
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
