import * as configFile from '../../config.json';
import { EnvType, ConfigType } from '../types';

// 環境設定
const env = process.env.NODE_ENV || 'dev';

// 型安全にする
const typedEnv = env as EnvType;
const typedConfig = configFile as ConfigType;

// 設定を取得する関数
export function getConfig() {
    return {
        token: typedConfig.token,
        guildId: typedConfig[typedEnv]["sv-id"],
        mysql: typedConfig[typedEnv].mysql
    };
} 