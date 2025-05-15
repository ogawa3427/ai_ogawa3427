import { Events, ApplicationCommandType } from 'discord.js';
import { client } from './client';
import { getConfig } from '../config';
import { fetchMessages } from './messages';
import { createTables, pool } from '../database';
import { ChromaClient } from "chromadb";
import axios from "axios";

// 設定の型定義
interface ChromaConfig {
    host: string;
    port: string;
    collection: string;
}

interface EnvironmentConfig {
    'sv-id': string;
    mysql: {
        host: string;
        port: string;
        user: string;
        password: string;
        database: string;
    };
    chroma: ChromaConfig;
}

interface Config {
    token: string;
    guildId: string;
    dev: EnvironmentConfig;
    meta: EnvironmentConfig;
}

// 設定を取得
const config = getConfig() as unknown as Config;

// Chromaの接続情報を取得する関数
function getChromaConfig() {
    const env = process.env.NODE_ENV === 'production' ? 'meta' : 'dev';
    const chromaConfig = config[env].chroma;
    return {
        url: `http://${chromaConfig.host}:${chromaConfig.port}`,
        collection: chromaConfig.collection
    };
}

// スラッシュコマンドの登録とイベント処理を設定
export function setupCommands() {
    // スラッシュコマンドの登録
    client.once(Events.ClientReady, async (c) => {
        console.log(`Ready! Logged in as ${c.user.tag}`);
        await createTables();
        
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
                },
                {
                    name: 'vectorize-history',
                    description: '未処理のメッセージ履歴をベクトル化してDBに保存します',
                    type: ApplicationCommandType.ChatInput,
                },
                {
                    name: 'search',
                    description: 'メッセージ履歴から類似の内容を検索します',
                    type: ApplicationCommandType.ChatInput,
                    options: [
                        {
                            name: 'query',
                            description: '検索クエリ',
                            type: 3, // STRING
                            required: true
                        },
                        {
                            name: 'limit',
                            description: '検索結果の最大件数',
                            type: 4, // INTEGER
                            required: false,
                            min_value: 1,
                            max_value: 10
                        }
                    ]
                }
            ];

            await client.application?.commands.set(commands, config.guildId);
            console.log('スラッシュコマンドを登録しました！');
        } catch (error) {
            console.error('スラッシュコマンドの登録に失敗しました:', error);
        }
    });

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
        } else if (interaction.commandName === 'vectorize-history') {
            await interaction.deferReply();

            try {
                const { url: CHROMA_URL, collection: COLLECTION_NAME } = getChromaConfig();
                const OLLAMA_ENDPOINT = (config as any).ollamaEndpoint || process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
                const EMBED_MODEL = (config as any).embedModel || process.env.EMBED_MODEL || "mxbai-embed-large";

                const chroma = new ChromaClient({ path: CHROMA_URL });
                const collection = await chroma.getOrCreateCollection({ name: COLLECTION_NAME });

                const [rows] = await pool.execute(
                    `SELECT id, channel_id, content FROM messages WHERE indexed = 0 LIMIT 10000`
                );

                if (!Array.isArray(rows) || rows.length === 0) {
                    await interaction.editReply("ベクトル化する新しいメッセージはありません。");
                    return;
                }

                let successCount = 0;
                let errorCount = 0;
                const totalRows = rows.length;

                // ユーザーに進捗を通知 (初回)
                await interaction.editReply(`処理を開始します。対象件数: ${totalRows}件`);

                for (let i = 0; i < totalRows; i++) {
                    const row = rows[i] as any;
                    try {
                        // 空文字列の場合はスキップ
                        if (!row.content || row.content.trim() === '') {
                            await pool.execute(
                                `UPDATE messages SET indexed = 1 WHERE id = ?`,
                                [row.id]
                            );
                            successCount++;
                            console.log(`Skipped empty content id=${row.id} (${successCount}/${totalRows})`);
                            continue;
                        }

                        const embedRes = await axios.post(
                            `${OLLAMA_ENDPOINT}/api/embeddings`,
                            { model: EMBED_MODEL, prompt: row.content }
                        );
                        const vector = embedRes.data.embedding;
                        
                        if (!Array.isArray(vector)) {
                             throw new Error(`Invalid embedding format for id=${row.id}`);
                        }

                        await collection.add({
                            ids: [row.id.toString()],
                            embeddings: [vector],
                            metadatas: [{ thread_id: row.thread_id, content: row.content }]
                        });

                        await pool.execute(
                            `UPDATE messages SET indexed = 1 WHERE id = ?`,
                            [row.id]
                        );
                        successCount++;
                        console.log(`Embedded & upserted id=${row.id} (${successCount}/${totalRows})`);
                        
                        // 定期的に進捗を更新 (例: 10件ごと、または最後)
                        if ((i + 1) % 10 === 0 || (i + 1) === totalRows) {
                            await interaction.editReply(`処理中: ${successCount}件成功 / ${errorCount}件失敗 (${i + 1}/${totalRows}件処理済み)`);
                        }

                    } catch (err: any) {
                        errorCount++;
                        console.error(`Failed to process id=${row.id}: `, err.message, err.stack, err.response?.data);
                    }
                }
                
                await interaction.editReply(`処理完了。\n成功: ${successCount}件\n失敗: ${errorCount}件 (全 ${totalRows}件中)`);

            } catch (error: any) {
                console.error('ベクトル化処理中にエラーが発生しました:', error.message, error.stack);
                await interaction.editReply('処理中にエラーが発生しました。詳細はログを確認してください。');
            }
        } else if (interaction.commandName === 'search') {
            await interaction.deferReply();

            try {
                const query = interaction.options.getString('query', true);
                const limit = interaction.options.getInteger('limit') || 5;

                const { url: CHROMA_URL, collection: COLLECTION_NAME } = getChromaConfig();
                const OLLAMA_ENDPOINT = (config as any).ollamaEndpoint || process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
                const EMBED_MODEL = (config as any).embedModel || process.env.EMBED_MODEL || "mxbai-embed-large";

                // クエリの埋め込みを取得
                const embedRes = await axios.post(
                    `${OLLAMA_ENDPOINT}/api/embeddings`,
                    { model: EMBED_MODEL, prompt: query }
                );
                const queryVec = embedRes.data.embedding;

                if (!Array.isArray(queryVec)) {
                    throw new Error("埋め込み取得エラー");
                }

                // Chromaクライアント初期化
                const chroma = new ChromaClient({ path: CHROMA_URL });
                const collection = await chroma.getCollection({ name: COLLECTION_NAME });
                if (!collection) throw new Error(`${COLLECTION_NAME} コレクションが見つかりません`);

                // 類似検索
                const results = await collection.query({
                    queryEmbeddings: [queryVec],
                    nResults: limit
                }) as any;

                console.log(results);

                // 結果の整形
                const ids = results.ids[0];
                const metadatas = results.metadatas[0];
                const distances = results.distances[0];

                if (!ids || ids.length === 0) {
                    await interaction.editReply("類似するメッセージが見つかりませんでした。");
                    return;
                }

                const response = ids.map((id: string, i: number) => {
                    const similarity = Number((1 - distances[i]).toFixed(4));
                    const content = metadatas[i].content;
                    const relevance = similarity > 0.8 ? '🔍 非常に類似' : 
                                    similarity > 0.6 ? '📌 類似' : 
                                    '💭 やや関連';
                    
                    return `${i + 1}. ${relevance} (類似度: ${similarity})\n${content}`;
                }).join('\n\n');

                await interaction.editReply(`検索クエリ: "${query}"\n\n検索結果 (${ids.length}件):\n\n${response}`);

            } catch (error: any) {
                console.error('検索処理中にエラーが発生しました:', error.message, error.stack);
                await interaction.editReply('検索中にエラーが発生しました。詳細はログを確認してください。');
            }
        }
    });
} 