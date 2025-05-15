import { client, setupCommands } from './discord';
import { getConfig } from './config';

// 設定を取得
const config = getConfig();

// コマンド設定
setupCommands();

// ログイン
client.login(config.token);
