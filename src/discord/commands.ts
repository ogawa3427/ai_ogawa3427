import { Events, ApplicationCommandType } from 'discord.js';
import { client } from './client';
import { getConfig } from '../config';
import { fetchMessages } from './messages';
import { createTables } from '../database';

// 設定を取得
const config = getConfig();

// スラッシュコマンドの登録とイベント処理を設定
export function setupCommands() {
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

    // pingコマンドを登録
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isCommand()) return;

        if (interaction.commandName === 'ping') {
            await interaction.reply('Pong!');
        }
    });
} 