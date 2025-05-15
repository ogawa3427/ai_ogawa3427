import { client, setupCommands, setupMessageListener } from './discord';
import { getConfig } from './config';

// 設定を取得
const config = getConfig();

// コマンド設定
setupCommands();

// メッセージリスナーを設定
setupMessageListener();

// ログイン
client.login(config.token);
